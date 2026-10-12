using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Eternities.CardView
{
    // The on-disk image cache (PRD v4 4.15.3): under the application-support directory, filled only
    // by images a view asked for, capped (2 GB by default) with the least recently used entry
    // leaving first. An entry is keyed on its full URL, query string included, and one older than
    // the origin's max-age is absent. Nothing here reads the network; time is the caller's clock,
    // in seconds since the Unix epoch.
    public sealed class ImageCache
    {
        public const long DefaultCap = 2L * 1024 * 1024 * 1024;
        public const long DefaultMaxAge = 7 * 24 * 3600;    // when the origin names none

        sealed class Entry
        {
            public string Key;
            public long Bytes, Expires, Used;
        }

        readonly string directory;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
        readonly object gate = new object();
        long total, stamp;

        public long Cap { get; set; } = DefaultCap;
        public long TotalBytes { get { lock (gate) { return total; } } }
        public int Count { get { lock (gate) { return entries.Count; } } }

        // Opens the cache in `directory`, taking in what an earlier session left there.
        public ImageCache(string directory)
        {
            this.directory = directory;
            Directory.CreateDirectory(directory);
            foreach (string meta in Directory.GetFiles(directory, "*.meta"))
            {
                string key = Path.GetFileNameWithoutExtension(meta);
                string image = Path.Combine(directory, key + ".jpg");
                string[] fields = File.ReadAllText(meta).Split(' ');
                if (!File.Exists(image) || fields.Length != 2 || !long.TryParse(fields[0], NumberStyles.None, CultureInfo.InvariantCulture, out long expires)
                    || !long.TryParse(fields[1], NumberStyles.None, CultureInfo.InvariantCulture, out long used))
                {
                    File.Delete(meta);
                    File.Delete(image);
                    continue;
                }
                var entry = new Entry { Key = key, Bytes = new FileInfo(image).Length, Expires = expires, Used = used };
                entries[key] = entry;
                total += entry.Bytes;
                stamp = Math.Max(stamp, used);
            }
        }

        public static string KeyOf(string url)
        {
            using (SHA256 sha = SHA256.Create())
            {
                var hex = new StringBuilder(64);
                foreach (byte b in sha.ComputeHash(Encoding.UTF8.GetBytes(url)))
                {
                    hex.Append(b.ToString("x2"));
                }
                return hex.ToString();
            }
        }

        // The file that holds the image of this URL, or null when the cache has none that is still
        // fresh. A hit makes the entry the most recently used.
        public string Find(string url, long now)
        {
            lock (gate)
            {
                string key = KeyOf(url);
                if (!entries.TryGetValue(key, out Entry entry))
                {
                    return null;
                }
                if (entry.Expires <= now)
                {
                    Remove(entry);
                    return null;
                }
                entry.Used = ++stamp;
                return Path.Combine(directory, key + ".jpg");
            }
        }

        // Keeps an image a view asked for, fresh for `maxAge` seconds, and makes room for it.
        public void Store(string url, byte[] image, long maxAge, long now)
        {
            lock (gate)
            {
                string key = KeyOf(url);
                if (entries.TryGetValue(key, out Entry old))
                {
                    Remove(old);
                }
                if (image.Length > Cap)
                {
                    return;
                }
                var entry = new Entry { Key = key, Bytes = image.Length, Expires = now + (maxAge > 0 ? maxAge : DefaultMaxAge), Used = ++stamp };
                File.WriteAllBytes(Path.Combine(directory, key + ".jpg"), image);
                File.WriteAllText(Path.Combine(directory, key + ".meta"), entry.Expires.ToString(CultureInfo.InvariantCulture) + " " + entry.Used.ToString(CultureInfo.InvariantCulture));
                entries[key] = entry;
                total += entry.Bytes;
                while (total > Cap)
                {
                    Entry oldest = null;
                    foreach (Entry candidate in entries.Values)
                    {
                        if (candidate != entry && (oldest == null || candidate.Used < oldest.Used))
                        {
                            oldest = candidate;
                        }
                    }
                    Remove(oldest);
                }
            }
        }

        // Clearing the cache is a settings action (PRD v4 4.15.3), and how a cold bench run starts.
        public void Clear()
        {
            lock (gate)
            {
                foreach (Entry entry in new List<Entry>(entries.Values))
                {
                    Remove(entry);
                }
            }
        }

        void Remove(Entry entry)
        {
            entries.Remove(entry.Key);
            total -= entry.Bytes;
            File.Delete(Path.Combine(directory, entry.Key + ".jpg"));
            File.Delete(Path.Combine(directory, entry.Key + ".meta"));
        }

        // The max-age of a Cache-Control header in seconds, or 0 when it names none.
        public static long MaxAge(string cacheControl)
        {
            if (cacheControl == null)
            {
                return 0;
            }
            foreach (string part in cacheControl.Split(','))
            {
                string directive = part.Trim();
                if (directive.StartsWith("max-age=", StringComparison.OrdinalIgnoreCase)
                    && long.TryParse(directive.Substring(8), NumberStyles.None, CultureInfo.InvariantCulture, out long seconds))
                {
                    return seconds;
                }
            }
            return 0;
        }
    }
}
