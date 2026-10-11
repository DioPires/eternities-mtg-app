using System;
using System.Collections.Generic;
using Eternities.CardView;
using Eternities.Data;
using NUnit.Framework;

namespace Eternities.Tests
{
    // PRD v4 4.15: what the loader may ask Scryfall's image hosts for, and when. Each test is one
    // sentence of 4.15.4, on a clock the test moves.
    public class ImagePolicyTests
    {
        double now;
        ImagePolicy policy;

        [SetUp]
        public void Begin()
        {
            now = 1000;
            policy = new ImagePolicy(() => now);
        }

        static string Url(int n) => ImageUrls.Face($"00000000-0000-4000-8000-{n:x12}", 1783948714, ImageSize.Normal);

        List<string> Started()
        {
            var started = new List<string>();
            for (string url = policy.Next(); url != null; url = policy.Next())
            {
                started.Add(url);
            }
            return started;
        }

        [Test]
        public void AUrlIsTheFixedPatternOverAValidatedId()
        {
            Assert.That(ImageUrls.Face("fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", 1783948714, ImageSize.Normal),
                Is.EqualTo("https://cards.scryfall.io/normal/front/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?1783948714"));
            Assert.That(ImageUrls.Face("fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", 7, ImageSize.Large, back: true),
                Is.EqualTo("https://cards.scryfall.io/large/back/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?7"));
            // Nothing but a lower-case UUID reaches the path: a malformed path draws a 400, and a 400
            // pauses every request.
            foreach (string bad in new[] { null, "", "fa5466cc", "FA5466CC-AA57-4A7F-8B21-D92B2FE02E13", "fa5466cc-aa57-4a7f-8b21-d92b2fe02e1", "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13/", "../../../etc/passwd/aaaaaaaaaaaaaaaaaaaa", "fa5466cc_aa57_4a7f_8b21_d92b2fe02e13", "fa5466cc-aa57-4a7f-8b21-d92b2fe02e1g" })
            {
                Assert.Throws<ArgumentException>(() => ImageUrls.Face(bad, 1, ImageSize.Normal), bad);
            }
            Assert.Throws<ArgumentException>(() => ImageUrls.Face("fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", -1, ImageSize.Normal));
            Assert.That(ImageUrls.Allowed(ImageUrls.CardBack));
            Assert.That(ImageUrls.Allowed(Url(1)));
            Assert.That(ImageUrls.Allowed("https://api.scryfall.com/cards/named"), Is.False);
            Assert.That(ImageUrls.Allowed("http://cards.scryfall.io/normal/front/f/a/x.jpg"), Is.False);
            Assert.That(ImageUrls.Allowed("https://cards.scryfall.io.example.org/normal/front/f/a/x.jpg"), Is.False);
            Assert.That((ImageUrls.Width(ImageSize.Normal), ImageUrls.Height(ImageSize.Normal)), Is.EqualTo((488, 680)));
            Assert.That((ImageUrls.Width(ImageSize.Large), ImageUrls.Height(ImageSize.Large)), Is.EqualTo((672, 936)));
        }

        // docs/data-contract.md, section 9: a second face is not a back image.
        [Test]
        public void ABackImageIsThePrintingsBackOrTheMeldResult()
        {
            var printing = new PackPrinting { Id = "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", ImageTs = 5 };
            var split = new PackCard { Layout = "split", Back = new PackFace { Name = "Ice" }, Printings = new[] { printing } };
            Assert.That(ImageUrls.Back(split, printing, ImageSize.Large), Is.Null);
            var transform = new PackCard { Layout = "transform", Back = new PackFace { Name = "Serra Faithkeeper" }, Printings = new[] { printing } };
            Assert.That(ImageUrls.Back(transform, printing, ImageSize.Large), Is.EqualTo("https://cards.scryfall.io/large/back/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?5"));
            var meld = new PackCard { Layout = "meld", Back = new PackFace { Name = "Urza, Planeswalker", Id = "5a7a2a2a-aa57-4a7f-8b21-d92b2fe02e13", ImageTs = 9 }, Printings = new[] { printing } };
            Assert.That(ImageUrls.Back(meld, printing, ImageSize.Large), Is.EqualTo("https://cards.scryfall.io/large/front/5/a/5a7a2a2a-aa57-4a7f-8b21-d92b2fe02e13.jpg?9"));
            Assert.That(ImageUrls.Front(transform, ImageSize.Normal), Is.EqualTo("https://cards.scryfall.io/normal/front/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?5"));
        }

        [Test]
        public void SixAreInFlightAtMostAndTheNearestGoFirst()
        {
            for (int i = 0; i < 10; i++)
            {
                policy.Want(Url(i), priority: 10 - i);
            }
            Assert.That(Started(), Is.EqualTo(new[] { Url(9), Url(8), Url(7), Url(6), Url(5), Url(4) }));
            Assert.That(policy.InFlight, Is.EqualTo(6));
            policy.Succeeded(Url(9));
            Assert.That(Started(), Is.EqualTo(new[] { Url(3) }));
            policy.Unwant(Url(2));
            policy.Succeeded(Url(8));
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }), "what no view wants any more is not asked for");
        }

        [Test]
        public void AServerErrorIsRetriedAtOneFourAndSixteenSecondsAndThenLeftForTheSession()
        {
            policy.Want(Url(1), 0);
            foreach (double wait in new[] { 1.0, 4.0, 16.0 })
            {
                Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
                policy.Failed(Url(1), ImageFailure.Server);
                now += wait - 0.01;
                Assert.That(Started(), Is.Empty, $"not before {wait} s");
                now += 0.01;
            }
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
            policy.Failed(Url(1), ImageFailure.Server);
            now += 3600;
            Assert.That(Started(), Is.Empty);
            Assert.That(policy.IsFinal(Url(1)));
            // Another image's success does not bring it back.
            policy.Want(Url(2), 0);
            Started();
            policy.Succeeded(Url(2));
            Assert.That(Started(), Is.Empty);
        }

        void FailOnTheNetworkUntilLeft(string url)
        {
            foreach (double wait in new[] { 1.0, 4.0, 16.0, 0.0 })
            {
                Assert.That(Started(), Has.Member(url));
                policy.Failed(url, ImageFailure.Network);
                now += wait;
            }
        }

        [Test]
        public void WhatTheNetworkLostReturnsWhenAnyRequestSucceeds()
        {
            policy.Want(Url(1), 0);
            FailOnTheNetworkUntilLeft(Url(1));
            Assert.That(Started(), Is.Empty);
            Assert.That(policy.IsFinal(Url(1)), Is.False);
            policy.Want(Url(2), 5);
            Assert.That(Started(), Is.EqualTo(new[] { Url(2) }));
            policy.Succeeded(Url(2));
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
        }

        [Test]
        public void OneServerErrorAmongNetworkFailuresLeavesItForTheSession()
        {
            policy.Want(Url(1), 0);
            Started();
            policy.Failed(Url(1), ImageFailure.Network);
            now += 1;
            Started();
            policy.Failed(Url(1), ImageFailure.Server);
            now += 4;
            Started();
            policy.Failed(Url(1), ImageFailure.Network);
            now += 16;
            Started();
            policy.Failed(Url(1), ImageFailure.Network);
            Assert.That(policy.IsFinal(Url(1)));
        }

        [Test]
        public void AVisitorWhoStandsStillGetsOneRetryEveryThirtySeconds()
        {
            policy.Want(Url(1), 0);
            policy.Want(Url(2), 1);
            foreach (double wait in new[] { 1.0, 4.0, 16.0, 0.0 })
            {
                Assert.That(Started(), Is.EqualTo(new[] { Url(1), Url(2) }));
                policy.Failed(Url(1), ImageFailure.Network);
                policy.Failed(Url(2), ImageFailure.Network);
                now += wait;
            }
            now += 29;
            Assert.That(Started(), Is.Empty);
            now += 1;
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }), "one URL, the nearest");
            policy.Failed(Url(1), ImageFailure.Network);
            Assert.That(Started(), Is.Empty);
            now += 30;
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
            policy.Succeeded(Url(1));
            Assert.That(Started(), Is.EqualTo(new[] { Url(2) }), "the network is back: the other returns at once");
        }

        [Test]
        public void AThrottlePausesEveryRequestAndResumesWithOneInFlight()
        {
            for (int i = 0; i < 8; i++)
            {
                policy.Want(Url(i), i);
            }
            Assert.That(Started().Count, Is.EqualTo(6));
            policy.Failed(Url(0), ImageFailure.Throttled);
            Assert.That(policy.Paused);
            Assert.That(policy.PausedUntil, Is.EqualTo(now + 30));
            // The five still in flight when the pause began: a throttle among them belongs to this
            // pause, and its URL is queued again.
            policy.Failed(Url(1), ImageFailure.Throttled);
            Assert.That(policy.Pauses, Is.EqualTo(1));
            Assert.That(policy.PausedUntil, Is.EqualTo(now + 30));
            for (int i = 2; i < 6; i++)
            {
                policy.Succeeded(Url(i));
            }
            now += 29.9;
            Assert.That(Started(), Is.Empty);
            now += 0.1;
            // One request in flight until one succeeds, the URL that drew the pause among the queued.
            Assert.That(Started(), Is.EqualTo(new[] { Url(0) }));
            policy.Succeeded(Url(0));
            Assert.That(Started().Count, Is.EqualTo(3), "back to six: 1, 6 and 7 are all that is left");
        }

        [Test]
        public void APauseIsAtLeastItsRetryAfterAndDoublesAsServed()
        {
            policy.Want(Url(1), 0);
            Started();
            policy.Failed(Url(1), ImageFailure.Throttled, retryAfter: 45);
            Assert.That(policy.PausedUntil, Is.EqualTo(now + 45), "longer if Retry-After says so");
            now += 45;
            Started();
            policy.Failed(Url(1), ImageFailure.Throttled, retryAfter: 10);
            Assert.That(policy.PausedUntil, Is.EqualTo(now + 90), "twice the last, which is longer than its own Retry-After");
            Assert.That(policy.Stopped, Is.False);
        }

        [Test]
        public void TheThirdPauseIsNotServed()
        {
            policy.Want(Url(1), 0);
            policy.Want(Url(2), 1);
            Started();
            policy.Failed(Url(1), ImageFailure.Throttled);
            policy.Succeeded(Url(2));
            now += 30;
            Started();
            policy.Failed(Url(1), ImageFailure.Throttled);
            Assert.That(policy.PausedUntil, Is.EqualTo(now + 60));
            now += 60;
            Started();
            policy.Failed(Url(1), ImageFailure.Throttled);
            Assert.That(policy.Stopped, "the loader stops fetching for the rest of the session");
            now += 86400;
            policy.Want(Url(3), 0);
            Assert.That(Started(), Is.Empty);
        }

        [Test]
        public void AnyOther4xxAndARefusedRedirectAreFinalForThatUrlOnly()
        {
            policy.Want(Url(1), 0);
            policy.Want(Url(2), 1);
            Started();
            policy.Failed(Url(1), ImageFailure.Refused);
            Assert.That(policy.IsFinal(Url(1)));
            Assert.That(policy.Paused, Is.False);
            policy.Succeeded(Url(2));
            policy.Want(Url(1), 0);
            Assert.That(Started(), Is.Empty);
        }

        // PRD v4 7.4.3: a view is told when its image is failing to load. A network failure is
        // never final, so the loader's answer never comes: this is the only word a view gets.
        [Test]
        public void AnImageIsFailingFromItsFirstFailureUntilItArrives()
        {
            Assert.That(policy.Failing(Url(1)), Is.False, "an image nobody asked for is not failing");
            policy.Want(Url(1), 1);
            policy.Want(Url(2), 2);
            Assert.That(policy.Failing(Url(1)), Is.False, "nor is one that is only waiting its turn");
            Assert.That(Started(), Is.EqualTo(new[] { Url(1), Url(2) }));
            Assert.That(policy.Failing(Url(1)), Is.False, "nor one that is on its way");

            policy.Failed(Url(1), ImageFailure.Network);
            Assert.That(policy.Failing(Url(1)), "from the first failure, with every retry still to come");
            Assert.That(policy.Failing(Url(2)), Is.False, "the failure is that image's alone");
            foreach (double wait in new double[] { 1, 4, 16 })
            {
                now += wait;
                Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
                Assert.That(policy.Failing(Url(1)), "and while a retry is in flight");
                policy.Failed(Url(1), ImageFailure.Network);
            }
            Assert.That(policy.IsFinal(Url(1)), Is.False);
            Assert.That(policy.Failing(Url(1)), "and once it is left until the network is back");

            // The network is back: the other image arrives, and the lost one starts again from nothing.
            policy.Succeeded(Url(2));
            Assert.That(policy.Failing(Url(1)), Is.False);
            Assert.That(Started(), Is.EqualTo(new[] { Url(1) }));
            policy.Succeeded(Url(1));
            Assert.That(policy.Failing(Url(1)), Is.False);
        }

        [Test]
        public void EveryWantedImageIsFailingWhileAPauseHoldsItBack()
        {
            policy.Want(Url(1), 1);
            policy.Want(Url(2), 2);
            Assert.That(Started(), Has.Count.EqualTo(2));
            policy.Failed(Url(1), ImageFailure.Throttled);
            Assert.That(policy.Paused);
            Assert.That(policy.Failing(Url(1)));
            Assert.That(policy.Failing(Url(2)), "nothing is asked for during a pause, so nothing wanted is coming");
            Assert.That(policy.Failing(Url(3)), Is.False, "an image nobody asked for is still not failing");
            policy.Failed(Url(2), ImageFailure.Refused);
            now += ImagePolicy.Pause;
            Assert.That(policy.Paused, Is.False);
            Assert.That(policy.Failing(Url(1)), Is.False, "the pause is over and this image never failed by itself");
            Assert.That(policy.Failing(Url(2)), "a final answer is a failure for the session");
        }
    }
}
