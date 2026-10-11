using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Threading;
using Eternities.CardView;
using Eternities.Data;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // The loader against a server of the test's own on 127.0.0.1 (PRD v4 4.15.4): what it sends,
    // what it keeps, and what each answer does. No test reaches Scryfall.
    public class ScryfallImagesTests
    {
        sealed class Server : IDisposable
        {
            readonly HttpListener listener = new HttpListener();
            public readonly List<(string Path, string UserAgent, string Accept)> Requests = new List<(string, string, string)>();
            public Func<string, (int Status, string Header, string Value)> Answer = path => (200, "Cache-Control", "max-age=3600");
            public readonly int Port;
            public byte[] Image;

            public Server()
            {
                for (Port = 38200; ; Port++)
                {
                    try
                    {
                        listener.Prefixes.Clear();
                        listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
                        listener.Start();
                        break;
                    }
                    catch (Exception) when (Port < 38300)
                    {
                    }
                }
                new Thread(Serve) { IsBackground = true }.Start();
            }

            void Serve()
            {
                while (listener.IsListening)
                {
                    HttpListenerContext context;
                    try
                    {
                        context = listener.GetContext();
                    }
                    catch (Exception)
                    {
                        return;
                    }
                    string path = context.Request.Url.PathAndQuery;
                    (int status, string header, string value) = Answer(path);
                    lock (Requests)
                    {
                        Requests.Add((path, context.Request.UserAgent, context.Request.Headers["Accept"]));
                    }
                    context.Response.StatusCode = status;
                    if (header != null)
                    {
                        context.Response.AddHeader(header, value);
                    }
                    if (status == 200)
                    {
                        context.Response.ContentType = "image/jpeg";
                        context.Response.OutputStream.Write(Image, 0, Image.Length);
                    }
                    context.Response.Close();
                }
            }

            public int Count
            {
                get
                {
                    lock (Requests)
                    {
                        return Requests.Count;
                    }
                }
            }

            bool closed;

            public void Dispose()
            {
                if (!closed)
                {
                    closed = true;
                    listener.Stop();
                    listener.Close();
                }
            }
        }

        Server server;
        ScryfallImages images;
        string cacheDirectory;

        // The `normal` image of a printing: the address a stand asks for.
        static string Card(int n) => ImageUrls.Face($"aaaaaaaa-0000-4000-8000-{n:x12}", 1783948714, ImageSize.Normal);

        [SetUp]
        public void Begin()
        {
            server = new Server();
            var texture = new Texture2D(488, 680, TextureFormat.RGB24, mipChain: false);
            server.Image = texture.EncodeToJPG();
            UnityEngine.Object.Destroy(texture);
            cacheDirectory = Path.Combine(Path.GetTempPath(), "eternities-images-test-" + Guid.NewGuid().ToString("N"));
            images = ScryfallImages.Create(cacheDirectory);
            // Every request goes to the test's server, with the path Scryfall would have been asked for.
            images.Address = url => $"http://127.0.0.1:{server.Port}{new Uri(url).PathAndQuery}";
        }

        [TearDown]
        public void End()
        {
            UnityEngine.Object.Destroy(images.gameObject);
            server.Dispose();
            if (Directory.Exists(cacheDirectory))
            {
                Directory.Delete(cacheDirectory, recursive: true);
            }
        }

        static IEnumerator Until(Func<bool> done, float seconds, string what)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (!done())
            {
                Assert.That(Time.realtimeSinceStartup, Is.LessThan(until), $"{what} did not happen in {seconds} s");
                yield return null;
            }
        }

        [UnityTest]
        public IEnumerator ARequestNamesTheApplicationAndItsImageIsKeptOnDisk()
        {
            Texture2D got = null;
            bool answered = false;
            images.Request(Card(1), 3, texture => { got = texture; answered = true; });
            yield return Until(() => answered, 20, "the image");
            Assert.That(got, Is.Not.Null);
            Assert.That((got.width, got.height), Is.EqualTo((488, 680)));
            UnityEngine.Object.Destroy(got);

            Assert.That(server.Count, Is.EqualTo(1));
            (string path, string userAgent, string accept) = server.Requests[0];
            Assert.That(path, Is.EqualTo("/normal/front/a/a/aaaaaaaa-0000-4000-8000-000000000001.jpg?1783948714"));
            Assert.That(userAgent, Is.EqualTo($"Eternities/{Application.version} (+https://github.com/DioPires/eternities-mtg-app)"));
            StringAssert.StartsWith("Eternities/", userAgent);
            Assert.That(accept, Is.EqualTo("image/*"));

            // The second time the image comes from the disk, and the server hears nothing.
            string url = Card(1);
            yield return Until(() => images.Cache.Count == 1, 10, "the cache entry");
            Assert.That(File.ReadAllBytes(images.Cache.Find(url, DateTimeOffset.UtcNow.ToUnixTimeSeconds())), Is.EqualTo(server.Image));
            answered = false;
            images.Request(Card(1), 3, texture => { got = texture; answered = true; });
            yield return Until(() => answered, 20, "the image from disk");
            Assert.That(got, Is.Not.Null);
            UnityEngine.Object.Destroy(got);
            Assert.That(server.Count, Is.EqualTo(1));
            Assert.That((images.FromNetwork, images.FromDisk), Is.EqualTo((1, 1)));
        }

        [UnityTest]
        public IEnumerator ARedirectToAnotherHostIsRefusedAndAMissingImageIsFinal()
        {
            server.Answer = path => path.Contains("000000000001") ? (302, "Location", "https://example.org/elsewhere.jpg") : (404, null, null);
            int answers = 0;
            Texture2D first = null, second = null;
            images.Request(Card(1), 1, texture => { first = texture; answers++; });
            images.Request(Card(2), 2, texture => { second = texture; answers++; });
            yield return Until(() => answers == 2, 20, "the two answers");
            Assert.That(first, Is.Null);
            Assert.That(second, Is.Null);
            Assert.That(server.Count, Is.EqualTo(2), "neither is asked for again");
            Assert.That(images.Policy.IsFinal(Card(1)));
            Assert.That(images.Policy.Paused, Is.False, "a 404 is about one image, not about the client");
            // Asked for again, each answers at once with no image and no request.
            images.Request(Card(1), 1, texture => answers++);
            Assert.That(answers, Is.EqualTo(3));
            yield return new WaitForSecondsRealtime(0.5f);
            Assert.That(server.Count, Is.EqualTo(2));
        }

        [UnityTest]
        public IEnumerator AThrottlePausesEveryRequest()
        {
            server.Answer = path => (429, "Retry-After", "120");
            for (int n = 1; n <= 8; n++)
            {
                images.Request(Card(n), n, texture => { });
            }
            yield return Until(() => images.Policy.Paused, 20, "the pause");
            yield return new WaitForSecondsRealtime(1);
            Assert.That(server.Count, Is.EqualTo(6), "the six in flight were sent, and nothing after the 429");
            Assert.That(images.Policy.PausedUntil - Time.realtimeSinceStartupAsDouble, Is.InRange(110, 120), "the pause is as long as Retry-After says");
            Assert.That(images.Policy.Pauses, Is.EqualTo(1), "the other five 429s belong to the same pause");
        }

        // PRD v4 7.4.3, question 5 of the slice: with Scryfall unreachable a cached image still
        // shows, and an uncached one leaves its stand on the swatch without an error.
        [UnityTest]
        public IEnumerator WithTheNetworkDownACachedImageStillShows()
        {
            bool answered = false;
            Texture2D got = null;
            images.Request(Card(1), 1, texture => { got = texture; answered = true; });
            yield return Until(() => answered, 20, "the image");
            UnityEngine.Object.Destroy(got);
            yield return Until(() => images.Cache.Count == 1, 10, "the cache entry");

            int deadPort = server.Port;
            server.Dispose();
            images.Address = url => $"http://127.0.0.1:{deadPort}{new Uri(url).PathAndQuery}";
            answered = false;
            bool uncachedAnswered = false;
            images.Request(Card(1), 1, texture => { got = texture; answered = true; });
            images.Request(Card(2), 2, texture => uncachedAnswered = true);
            yield return Until(() => answered, 20, "the cached image");
            Assert.That(got, Is.Not.Null);
            UnityEngine.Object.Destroy(got);
            yield return new WaitForSecondsRealtime(2.5f);
            Assert.That(uncachedAnswered, Is.False, "the uncached image is still wanted: its stand shows its swatch meanwhile");
            Assert.That(images.Policy.IsFinal(Card(2)), Is.False, "a network failure is not final");
            Assert.That(images.Policy.Paused, Is.False);
        }
    }
}
