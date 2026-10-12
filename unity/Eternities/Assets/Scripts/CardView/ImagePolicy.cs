using System;
using System.Collections.Generic;

namespace Eternities.CardView
{
    public enum ImageFailure
    {
        Network,        // no response at all
        Server,         // a 5xx
        Throttled,      // a 429, a 403 or a 400: a statement about the client
        Refused,        // any other 4xx, or a redirect the loader does not follow
    }

    // When the loader may ask Scryfall's image hosts for what, and what each answer does to the next
    // request (PRD v4 4.15.4). It holds no image and makes no request: the loader tells it what is
    // wanted and what came back, and asks it what to start. Time is the clock it is given, in
    // seconds, so every rule below is tested without waiting.
    public sealed class ImagePolicy
    {
        public const int Concurrent = 6;                    // across both hostnames
        public const double Pause = 30, IdleRetry = 30;
        public const int PausesServed = 2;                  // the third pause of a session stops the loader
        static readonly double[] Backoff = { 1, 4, 16 };

        enum State
        {
            Queued,
            InFlight,
            LeftAfterNetwork,   // returns when any request succeeds, and by the idle retry
            Final,              // not asked again this session
        }

        sealed class Entry
        {
            public string Url;
            public State State;
            public float Priority;
            public int Failures;
            public bool SawServerError;
            public double NotBefore, StartedAt;
            public bool Wanted = true;
        }

        readonly Func<double> clock;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
        double pausedUntil, lastPause, lastIdleRetry = double.NegativeInfinity;
        int pauses;
        bool probing;       // after a pause: one request in flight until one succeeds

        public int InFlight { get; private set; }
        public bool Stopped { get; private set; }
        public bool Paused => !Stopped && clock() < pausedUntil;
        public double PausedUntil => pausedUntil;
        public int Pauses => pauses;

        public ImagePolicy(Func<double> clock)
        {
            this.clock = clock;
        }

        // A view wants this image. The lowest priority is asked for first: the loader passes the
        // distance to the stand. Wanting a URL again only moves its priority.
        public void Want(string url, float priority)
        {
            if (!entries.TryGetValue(url, out Entry entry))
            {
                entries[url] = entry = new Entry { Url = url, State = State.Queued };
            }
            entry.Priority = priority;
            entry.Wanted = true;
        }

        // No view wants it any more. A request in flight is left to finish.
        public void Unwant(string url)
        {
            if (entries.TryGetValue(url, out Entry entry))
            {
                entry.Wanted = false;
            }
        }

        public bool IsFinal(string url) => entries.TryGetValue(url, out Entry entry) && entry.State == State.Final;

        // Is an image that was asked for being kept from its view? True from its first failed
        // attempt until it arrives, the retries included, and for as long as a pause or the stop
        // holds every request back. A network failure is never final (the image returns with the
        // network), so this is the only word a view gets that its image is not coming for now.
        public bool Failing(string url) => entries.TryGetValue(url, out Entry entry)
            && (Stopped || Paused || entry.Failures > 0 || entry.State == State.LeftAfterNetwork || entry.State == State.Final);

        // The URL to request now, or null. The caller starts the request it is handed.
        public string Next()
        {
            double now = clock();
            if (Stopped || now < pausedUntil || InFlight >= (probing ? 1 : Concurrent))
            {
                return null;
            }
            Entry best = null;
            bool anyLeft = false;
            foreach (Entry entry in entries.Values)
            {
                anyLeft |= entry.State == State.LeftAfterNetwork && entry.Wanted;
                if (entry.State == State.Queued && entry.Wanted && entry.NotBefore <= now && (best == null || entry.Priority < best.Priority))
                {
                    best = entry;
                }
            }
            // Nothing to ask, nothing in flight, and images lost to a dead network: one of them is
            // tried every 30 s, so a visitor who stands still gets images back without doing anything.
            if (best == null && anyLeft && InFlight == 0 && now - lastIdleRetry >= IdleRetry)
            {
                foreach (Entry entry in entries.Values)
                {
                    if (entry.State == State.LeftAfterNetwork && entry.Wanted && (best == null || entry.Priority < best.Priority))
                    {
                        best = entry;
                    }
                }
                lastIdleRetry = now;
            }
            if (best == null)
            {
                return null;
            }
            best.State = State.InFlight;
            best.StartedAt = now;
            InFlight++;
            return best.Url;
        }

        public void Succeeded(string url)
        {
            // Only a request made after the pause proves the hosts answer again: one that was already
            // in flight when the pause began says nothing about it.
            probing &= entries[url].StartedAt < pausedUntil;
            entries.Remove(url);
            InFlight--;
            // A dropped connection does not pin images out until restart: what the network lost is
            // asked for again, from the start.
            foreach (Entry entry in entries.Values)
            {
                if (entry.State == State.LeftAfterNetwork)
                {
                    entry.State = State.Queued;
                    entry.Failures = 0;
                    entry.NotBefore = 0;
                }
            }
        }

        // `retryAfter` is the response's Retry-After in seconds, 0 when it had none.
        public void Failed(string url, ImageFailure failure, double retryAfter = 0)
        {
            Entry entry = entries[url];
            InFlight--;
            double now = clock();
            switch (failure)
            {
                case ImageFailure.Refused:
                    entry.State = State.Final;
                    break;
                case ImageFailure.Throttled:
                    // Every request pauses, not only this one, and this URL is queued again.
                    entry.State = State.Queued;
                    if (now < pausedUntil)
                    {
                        break;      // it belongs to the pause in force: not a repeat
                    }
                    if (pauses == PausesServed)
                    {
                        Stopped = true;     // the third pause is not served
                        break;
                    }
                    pauses++;
                    lastPause = Math.Max(pauses == 1 ? Pause : 2 * lastPause, retryAfter);
                    pausedUntil = now + lastPause;
                    probing = true;
                    break;
                default:
                    entry.SawServerError |= failure == ImageFailure.Server;
                    if (entry.Failures < Backoff.Length)
                    {
                        entry.State = State.Queued;
                        entry.NotBefore = now + Backoff[entry.Failures++];
                    }
                    else
                    {
                        // After three retries: left for the session if the server ever answered with
                        // a 5xx, left until the network is back if it never answered at all.
                        entry.State = entry.SawServerError ? State.Final : State.LeftAfterNetwork;
                        lastIdleRetry = now;    // the idle retry comes 30 s after the last attempt, not at once
                    }
                    break;
            }
        }
    }
}
