using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;
using Eternities.Data;
using UnityEngine;
using UnityEngine.Networking;

namespace Eternities.CardView
{
    // The stand images from Scryfall's image hosts (PRD v4 4.15): the `normal` image of a card's
    // first printing, from the disk cache when it is there and fresh, from the network otherwise,
    // under the request policy of 4.15.4. A view asks; nothing here fetches ahead of one.
    public sealed class ScryfallImages : MonoBehaviour, IImageSource
    {
        public const string Repository = "https://github.com/DioPires/eternities-mtg-app";
        const int Timeout = 30, Hops = 3;

        // What every request says it is (PRD v4 4.15.4): an engine's HTTP stack sends its own
        // default unless one is set.
        public static string UserAgent => $"Eternities/{Application.version} (+{Repository})";

        ImagePolicy policy;
        ImageCache cache;
        readonly Dictionary<string, Action<Texture2D>> waiting = new Dictionary<string, Action<Texture2D>>();

        public ImagePolicy Policy => policy;
        public ImageCache Cache => cache;
        public int FromDisk { get; private set; }
        public int FromNetwork { get; private set; }
        public int Failed { get; private set; }
        // A test sends the requests to a server of its own. The product leaves this null.
        public Func<string, string> Address;

        static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        public static ScryfallImages Create(string cacheDirectory, Transform parent = null)
        {
            var source = new GameObject("Scryfall images").AddComponent<ScryfallImages>();
            source.transform.SetParent(parent, false);
            source.policy = new ImagePolicy(() => Time.realtimeSinceStartupAsDouble);
            source.cache = new ImageCache(cacheDirectory);
            return source;
        }

        public void Request(PackCard card, float distance, Action<Texture2D> done)
        {
            string url = ImageUrls.Front(card, ImageSize.Normal);
            string file = cache.Find(url, Now);
            if (file == null && (policy.Stopped || policy.IsFinal(url)))
            {
                done(null);     // no image this session: the stand stays its swatch (PRD v4 7.4.2)
                return;
            }
            waiting[url] = done;
            if (file != null)
            {
                StartCoroutine(FromFile(url, file, distance));
            }
            else
            {
                policy.Want(url, distance);
            }
        }

        public void Cancel(PackCard card)
        {
            string url = ImageUrls.Front(card, ImageSize.Normal);
            waiting.Remove(url);
            policy.Unwant(url);
        }

        void Update()
        {
            for (string url = policy.Next(); url != null; url = policy.Next())
            {
                StartCoroutine(Fetch(url));
            }
        }

        void Deliver(string url, Texture2D texture)
        {
            if (waiting.TryGetValue(url, out Action<Texture2D> done))
            {
                waiting.Remove(url);
                done(texture);
            }
            else
            {
                Destroy(texture);   // the view that asked has gone
            }
        }

        IEnumerator FromFile(string url, string file, float distance)
        {
            using (UnityWebRequest request = UnityWebRequestTexture.GetTexture("file://" + file, nonReadable: true))
            {
                yield return request.SendWebRequest();
                if (request.result == UnityWebRequest.Result.Success)
                {
                    FromDisk++;
                    Deliver(url, DownloadHandlerTexture.GetContent(request));
                }
                else if (waiting.ContainsKey(url))
                {
                    policy.Want(url, distance);     // a file that does not read is not an image: ask again
                }
            }
        }

        IEnumerator Fetch(string url)
        {
            string address = url;
            for (int hop = 0; ; hop++)
            {
                using (UnityWebRequest request = UnityWebRequestTexture.GetTexture(Address != null ? Address(address) : address, nonReadable: true))
                {
                    request.SetRequestHeader("User-Agent", UserAgent);
                    request.SetRequestHeader("Accept", "image/*");
                    request.redirectLimit = 0;      // a redirect is followed here or not at all
                    request.timeout = Timeout;
                    yield return request.SendWebRequest();
                    long code = request.responseCode;
                    if (code >= 300 && code < 400)
                    {
                        // The loader refuses a redirect to any other host (PRD v4 4.15.1).
                        string location = request.GetResponseHeader("Location");
                        if (hop < Hops && ImageUrls.Allowed(location))
                        {
                            address = location;
                            continue;
                        }
                        Fail(url, ImageFailure.Refused, 0);
                    }
                    else if (request.result == UnityWebRequest.Result.Success && code == 200)
                    {
                        Texture2D texture = DownloadHandlerTexture.GetContent(request);
                        byte[] bytes = request.downloadHandler.data;
                        long maxAge = ImageCache.MaxAge(request.GetResponseHeader("Cache-Control")), now = Now;
                        Task.Run(() => cache.Store(url, bytes, maxAge, now));
                        policy.Succeeded(url);
                        FromNetwork++;
                        Deliver(url, texture);
                    }
                    else if (code == 429 || code == 403 || code == 400)
                    {
                        double.TryParse(request.GetResponseHeader("Retry-After"), NumberStyles.Float, CultureInfo.InvariantCulture, out double retryAfter);
                        Fail(url, ImageFailure.Throttled, retryAfter);
                    }
                    else if (code >= 500)
                    {
                        Fail(url, ImageFailure.Server, 0);
                    }
                    else if (code >= 400)
                    {
                        Fail(url, ImageFailure.Refused, 0);
                    }
                    else
                    {
                        Fail(url, ImageFailure.Network, 0);    // no response, or one that is not an image
                    }
                    yield break;
                }
            }
        }

        void Fail(string url, ImageFailure failure, double retryAfter)
        {
            policy.Failed(url, failure, retryAfter);
            if (policy.IsFinal(url) || policy.Stopped)
            {
                Failed++;
                Deliver(url, null);
            }
        }
    }
}
