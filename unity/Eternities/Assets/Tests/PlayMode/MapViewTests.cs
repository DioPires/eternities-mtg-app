using System.Collections;
using Eternities.UI;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UIElements;

namespace Eternities.Tests
{
    // The map's clicks on a model of its own (PRD v4 6.3.4), laid out on a panel of the test's.
    public class MapViewTests
    {
        // DEC-1214 N3: a region with no site is named, and a click on it asks for no travel. Every
        // region of Dominaria has a site, so a world's map never reaches this.
        [UnityTest]
        public IEnumerator ARegionWithNoSiteIsNamedAndOffersNoTravel()
        {
            var settings = ScriptableObject.CreateInstance<PanelSettings>();
            var holder = new GameObject("map test");
            try
            {
                var document = holder.AddComponent<UIDocument>();
                document.panelSettings = settings;
                var view = new MapView();
                view.style.width = view.style.height = 400;
                document.rootVisualElement.Add(view);
                var model = new MapModel { Centre = Vector2.zero, HalfSide = 100 };
                model.Regions.Add(new MapModel.Area
                {
                    Name = "Nowhere", Label = Vector2.zero, Site = -1,
                    Outline = new[] { new Vector2(-50, -50), new Vector2(-50, 50), new Vector2(50, 50), new Vector2(50, -50) },
                });
                view.Show(model);
                int chosen = -2;
                view.Chosen = site => chosen = site;
                yield return null;
                yield return null;
                Assert.That(view.contentRect.width, Is.EqualTo(400).Within(0.5f), "the map is laid out");
                Vector2 label = view.ToView(model.Regions[0].Label);
                Assert.That(view.SiteAt(label), Is.EqualTo(-1));
                Assert.That(view.Describe(label), Is.EqualTo("Nowhere"));
                Assert.That(chosen, Is.EqualTo(-2), "nothing asked for travel");
            }
            finally
            {
                Object.Destroy(holder);
                Object.Destroy(settings);
            }
        }
    }
}
