using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Travel;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace Eternities.EditorTools
{
    // The batchmode scene generation entry point (PRD v4 8.2.5). It makes what the slice needs and an
    // engineer does not write by hand, from the pinned pack and nothing else, so a reviewer
    // reproduces the slice's world from the command line:
    //
    // - not committed: the part of the pack the slice reads, copied from `web/public/data/<hash>/`
    //   to `StreamingAssets/data/<hash>/` with every file checked against the pack's manifest, and
    //   each world's three files of contract v4 beside it, copied from the world's committed
    //   fixture under `contract/test-vectors/v4/layout/<slug>/` and decoded once
    //   (`WorldFiles.Generate`; the pipeline lays the world out, PRD v4 8.3.3);
    // - committed: the slice's plain materials under `Assets/Kits/core/Materials/` and
    //   `Assets/Kits/temperate/Materials/`, the kit's prop prefabs under
    //   `Assets/Kits/temperate/Prefabs/`, the persistent scene, `Assets/Scenes/Hub.unity`, and
    //   each quality level's volume profile under `Assets/Settings/`.
    //
    // A missing argument or a failure throws, and the editor turns an exception in an
    // `-executeMethod` target into exit code 1.
    public static class Generate
    {
        // The slice has one world (PRD v4 9.5).
        public static readonly string[] Worlds = { "dominaria" };

        public const string HubScene = "Assets/Scenes/Hub.unity";
        const string MaterialFolder = "Assets/Kits/core/Materials";

        public static void Run()
        {
            string reportOut = CommandLine.Optional("-reportOut");
            foreach (WorldFiles.Result world in Everything(CommandLine.Require("-packHash")))
            {
                Debug.Log($"Generate: {world.Slug}\n{world.Report}");
                if (reportOut != null)
                {
                    File.WriteAllText(reportOut, world.Report);
                }
            }
        }

        // The same from the editor's menu, for whoever has the project open.
        [MenuItem("Eternities/Generate")]
        static void FromTheMenu()
        {
            foreach (WorldFiles.Result world in Everything(ManifestHash()))
            {
                Debug.Log($"Generate: {world.Slug}\n{world.Report}");
            }
        }

        // Everything the entry point makes: each world's files, the slice's materials, the
        // persistent scene and the levels' volume profiles. Run again on a tree it has already
        // filled, it changes nothing.
        public static List<WorldFiles.Result> Everything(string packHash)
        {
            if (packHash != ManifestHash())
            {
                throw new InvalidDataException($"the project is pinned to pack {ManifestHash()}, not {packHash}");
            }
            var worlds = new List<WorldFiles.Result>();
            foreach (string slug in Worlds)
            {
                worlds.Add(Build(packHash, slug));
            }
            PersistentScene();
            LevelProfiles();
            return worlds;
        }

        // Where a quality level's volume profile is, beside its HDRP asset.
        public static string LevelProfile(string level) => $"Assets/Settings/HDRP {level} volume.asset";

        // The clouds of each quality level (PRD v4 5.7.1, 8.1.1): volumetric clouds at high and
        // medium, a cloud layer at low. That is a volume setting and not a switch of the HDRP
        // asset, so each level's HDRP asset names a volume profile of its own, which HDRP lays
        // over the project's defaults and under every volume of a scene. A profile is made once
        // with that one choice in it, and then is the owner's to tune. The HDRP assets name the
        // profiles in their own text, which `RenderPipelineTests` holds: saving an HDRP asset
        // from here would rewrite the whole file.
        public static void LevelProfiles()
        {
            foreach (string level in QualitySettings.names)
            {
                string path = LevelProfile(level);
                if (AssetDatabase.LoadAssetAtPath<VolumeProfile>(path) != null)
                {
                    continue;
                }
                var profile = ScriptableObject.CreateInstance<VolumeProfile>();
                AssetDatabase.CreateAsset(profile, path);
                if (level == "low")
                {
                    Override<VisualEnvironment>(profile).cloudType.Override((int)CloudType.CloudLayer);
                }
                else
                {
                    Override<VolumetricClouds>(profile).enable.Override(true);
                }
                EditorUtility.SetDirty(profile);
                AssetDatabase.SaveAssets();
            }
        }

        // A profile's override lives in the profile's own file, as the editor's inspector makes it.
        static T Override<T>(VolumeProfile profile) where T : VolumeComponent
        {
            T component = profile.Add<T>();
            component.hideFlags = HideFlags.HideInInspector | HideFlags.HideInHierarchy;
            AssetDatabase.AddObjectToAsset(component, profile);
            return component;
        }

        // The hash `StreamingAssets/data/manifest.json` names (PRD v4 8.3.1).
        public static string ManifestHash()
        {
            string manifest = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "data", "manifest.json"));
            return Json.Text(Json.Object(Json.Parse(manifest))["hash"]);
        }

        // The persistent scene (PRD v4 8.4.1): the template's camera, sun and sky, and the one object
        // that builds the rest at run time. The scene is opened and completed, never rebuilt, so the
        // identifiers the editor gave its objects stay and a second run saves nothing.
        public static void PersistentScene()
        {
            Scene scene = EditorSceneManager.OpenScene(HubScene, OpenSceneMode.Single);
            bool changed = false;
            App app = Object.FindAnyObjectByType<App>();
            if (app == null)
            {
                app = new GameObject("Eternities").AddComponent<App>();
                changed = true;
            }
            Material[] stands =
            {
                Lit("plinth-common-stone", new Color(0.46f, 0.45f, 0.43f), 0f, 0.25f),
                Lit("plinth-uncommon-bronze", new Color(0.55f, 0.36f, 0.20f), 0.8f, 0.45f),
                Lit("plinth-rare-silver", new Color(0.72f, 0.73f, 0.75f), 0.9f, 0.6f),
                Lit("plinth-mythic-gold", new Color(0.83f, 0.62f, 0.22f), 0.9f, 0.65f),
                Lit("stand-slab", new Color(0.05f, 0.05f, 0.06f), 0f, 0.3f),
            };
            if (app.StandMaterials == null || !stands.SequenceEqual(app.StandMaterials))
            {
                app.StandMaterials = stands;
                changed = true;
            }
            // The rims, one a colour class (PRD v4 5.5.1). They glow a little, by an emission that
            // the exposure does not scale, so the colour cue shows in every kit and at every time
            // of day: in a bright noon and at dusk alike.
            string[] classes = { "white", "blue", "black", "red", "green", "multicolour", "colourless" };
            Material[] rims = classes.Select((name, index) => Rim($"rim-{name}", StandField.ClassColours[index])).ToArray();
            if (app.RimMaterials == null || !rims.SequenceEqual(app.RimMaterials))
            {
                app.RimMaterials = rims;
                changed = true;
            }
            // The ground's. A terrain's shader takes `_NORMALMAP` and `_MASKMAP` from its layers at
            // run time, and a build holds only the variants that a material in it names: so there is
            // one material for layers that are colours only, one for layers with normal maps and
            // one for layers with normal and mask maps, and one more for a tile of five to eight
            // such layers (`WorldGround`), in the order of `App`'s ground constants.
            Material[] ground =
            {
                Ground("ground"), Ground("ground-normal", "_NORMALMAP"), Ground("ground-normal-mask", "_NORMALMAP", "_MASKMAP"),
                Ground("ground-8-normal-mask", "_TERRAIN_8_LAYERS", "_NORMALMAP", "_MASKMAP"),
            };
            if (app.GroundMaterials == null || !ground.SequenceEqual(app.GroundMaterials))
            {
                app.GroundMaterials = ground;
                changed = true;
            }
            changed |= Set(Lit("mannequin", new Color(0.78f, 0.76f, 0.72f), 0f, 0.4f), app.AvatarMaterial, m => app.AvatarMaterial = m);
            // Matt: on a ground this wide a smooth one is paid for in screen-space reflections, 5 ms a frame.
            changed |= Set(Lit("hub-floor", new Color(0.09f, 0.09f, 0.12f), 0f, 0.05f), app.HubGroundMaterial, m => app.HubGroundMaterial = m);
            changed |= Set(Lit("portal-frame", new Color(0.12f, 0.11f, 0.10f), 0.6f, 0.5f), app.PortalFrameMaterial, m => app.PortalFrameMaterial = m);
            changed |= Set(Unlit("portal-surface", new Color(0.35f, 0.75f, 1f, 1f), transparent: false), app.PortalSurfaceMaterial, m => app.PortalSurfaceMaterial = m);
            changed |= Set(Unlit("veil", new Color(0, 0, 0, 1), transparent: true), app.VeilMaterial, m => app.VeilMaterial = m);
            changed |= Set(Unlit("image-surface-cutout", Color.white, transparent: false, cutout: true), app.ImageSurfaceMaterial, m => app.ImageSurfaceMaterial = m);
            foreach ((string name, Shader held, System.Action<Shader> assign) in new (string, Shader, System.Action<Shader>)[]
            {
                ("Hidden/Eternities/Exhibit", app.ExhibitShader, shader => app.ExhibitShader = shader),
                ("Hidden/Eternities/ExhibitComposite", app.ExhibitCompositeShader, shader => app.ExhibitCompositeShader = shader),
            })
            {
                Shader shader = Shader.Find(name);
                if (shader == null)
                {
                    throw new InvalidDataException($"the shader {name} is not in the project");
                }
                if (shader != held)
                {
                    assign(shader);
                    changed = true;
                }
            }

            // The overlays' panel settings and the theme they name (PRD v4 8.1.2): two small assets,
            // made once. Everything else of the overlays is code.
            const string uiFolder = "Assets/Kits/core/UI";
            Directory.CreateDirectory(uiFolder);
            if (!File.Exists($"{uiFolder}/Runtime.tss"))
            {
                File.WriteAllText($"{uiFolder}/Runtime.tss", "@import url(\"unity-theme://default\");\n");
                AssetDatabase.ImportAsset($"{uiFolder}/Runtime.tss");
            }
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>($"{uiFolder}/Panel.asset");
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                panel.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>($"{uiFolder}/Runtime.tss");
                panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
                panel.referenceResolution = new Vector2Int(1920, 1080);
                panel.match = 1;    // by height, so text is the same size on a wide display
                AssetDatabase.CreateAsset(panel, $"{uiFolder}/Panel.asset");
                AssetDatabase.SaveAssets();
            }
            if (panel != app.PanelSettings)
            {
                app.PanelSettings = panel;
                changed = true;
            }

            // The kits' dressings (`KitDressing`): under each kit's `Resources/`, and named by nothing
            // in the scene, so the hub loads none of them (DEC-1055, N20).
            KitDressings();
            if (changed)
            {
                EditorUtility.SetDirty(app);
            }
            if (changed)
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
        }

        // A kit's dressing as the generation entry point leaves it.
        public static KitDressing Dressing(string kit) => AssetDatabase.LoadAssetAtPath<KitDressing>(DressingPath(kit));

        public static string DressingPath(string kit) => $"Assets/Kits/{kit}/Resources/{KitDressing.ResourceOf(kit)}.asset";

        // The kits whose dressing the generation entry point makes, and each one's loops: a family's
        // bed by the family's name, and a body of water's by its kind (`KitLoops`).
        public static readonly (string Kit, (string Name, string File)[] Loops)[] Kits =
        {
            ("temperate", new[] { ("meadow", "meadow_songbirds_loop"), ("river", "river_splashy_loop"), ("lake", "lake_lapping_loop") }),
            ("forest", new[] { ("forest", "forest_woodland_loop") }),
            ("coast", new[] { ("surf", "surf_shore_loop") }),
            ("swamp", new[] { ("marsh", "marsh_swamp_loop") }),
            ("mountain", new[] { ("alpine-wind", "alpine_wind_loop") }),
            ("volcanic", new[] { ("volcanic", "volcanic_rumble_loop"), ("lava", "lava_bubbling_loop") }),
        };

        // Each kit's dressing, made or brought up to date. A second run changes nothing.
        public static void KitDressings()
        {
            // The temperate kit's props (PRD v4 8.4.2): each prop's prefab, made once from its
            // model in the kit's own materials and then left alone.
            KitPrefabs.Make("temperate", KitPrefabs.Temperate);
            KitPrefabs.Make("temperate", KitPrefabs.TemperatePhotographs);
            // Its stones (PRD v4 5.4.16, 5.13.1), from its rocks; and a reading stone's dressed face
            // and its marks, cut pale into the dark stone as fresh cuts show (`StoneField`).
            KitStones.Make("temperate", KitStones.Temperate);
            Material tablet = Tablet();
            Material inscription = Lit("temperate-inscription", new Color(0.58f, 0.55f, 0.49f), 0f, 0.1f, "Assets/Kits/temperate/Materials");

            // The kit's path and gravel layers (PRD v4 8.4.5): each made once from the kit's
            // textures and then tuned in its own file. A tile is as wide as the ground its
            // photograph shows, which its source states. The path's photograph is an orange that
            // reads as sand, a mean of 181, 139 and 99 in sRGB: pulled to a packed earth's grey
            // brown, about 126, 112 and 95, so the trail reads as a road through green country.
            TerrainLayer[] layers =
            {
                KitLayer(DressPlan.PathLayer, "dirt_floor", "2k", 2.07f, new Color(0.45f, 0.62f, 0.95f)),
                KitLayer(DressPlan.GravelLayer, "ganges_river_pebbles", "2k", 2.16f, Color.white),
            };
            // The kit's variants (PRD v4 5.6.3, 8.12.1; DEC-1003): each one's ground layers and
            // props, as `Variants.Temperate` names them. A photographed ground is its photograph,
            // with no tint, on a tile as wide as the ground it shows.
            foreach (KeyValuePair<string, (string size, float metres, float gloss)> photograph in Photographed)
            {
                KitLayer(photograph.Key, photograph.Key, photograph.Value.size, photograph.Value.metres, Color.white, photograph.Value.gloss);
            }
            KitVariant[] variants = Variants.Temperate.Select(variant => new KitVariant
            {
                Name = variant.Name,
                Layers = variant.Ground.Select(ground => VariantLayer(ground.Layer)).ToArray(),
                Props = variant.Grows.Select(growth => PropOf(growth.Prefab, tree: growth.Category == "Trees")).ToArray(),
            }).ToArray();
            // The props are drawn instanced (`PropField`), and a material draws so only if it says so.
            foreach (KitProp prop in variants.SelectMany(variant => variant.Props))
            {
                foreach (Material material in prop.Materials.Concat(prop.Levels.SelectMany(level => level.Materials)))
                {
                    if (material != null && !material.enableInstancing)
                    {
                        material.enableInstancing = true;
                        EditorUtility.SetDirty(material);
                    }
                }
            }
            AssetDatabase.SaveAssets();

            foreach ((string kit, (string Name, string File)[] loops) in Kits)
            {
                var wanted = ScriptableObject.CreateInstance<KitDressing>();
                wanted.Kit = kit;
                wanted.Loops = loops.Select(loop => new KitLoop { Name = loop.Name, Clip = KitAudio(kit, loop.File) }).ToArray();
                if (kit == "temperate")
                {
                    wanted.Variants = variants;
                    wanted.Layers = layers;
                    // The kit's two water prefabs (PRD v4 5.6.3): made once from the water system's
                    // own preset for a river and for a lake, and then the owner's to tune.
                    wanted.River = WaterPrefab("temperate", "River", WaterSurfaceType.River);
                    wanted.Lake = WaterPrefab("temperate", "Lake", WaterSurfaceType.OceanSeaLake);
                    wanted.ReadingStone = KitStones.Prefab("temperate", "reading_stone");
                    wanted.Waystone = KitStones.Prefab("temperate", "waystone");
                    wanted.ChapterStone = KitStones.Prefab("temperate", "chapter_stone");
                    wanted.Tablet = tablet;
                    wanted.Inscription = inscription;
                }
                else if (kit == "coast")
                {
                    wanted.Sea = WaterPrefab("coast", "Sea", WaterSurfaceType.OceanSeaLake);
                }
                else if (kit == "volcanic")
                {
                    wanted.Lava = Lava();
                }
                string path = DressingPath(kit);
                var held = AssetDatabase.LoadAssetAtPath<KitDressing>(path);
                if (held == null)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    AssetDatabase.CreateAsset(wanted, path);
                    AssetDatabase.SaveAssets();
                    continue;
                }
                wanted.name = held.name;
                if (EditorJsonUtility.ToJson(wanted) != EditorJsonUtility.ToJson(held))
                {
                    EditorUtility.CopySerialized(wanted, held);
                    EditorUtility.SetDirty(held);
                    AssetDatabase.SaveAssets();
                }
                Object.DestroyImmediate(wanted);
            }
        }

        // A reading stone's dressed face (`StoneField`): the photograph of the highland's dark rock,
        // a tiling ground of the kit, laid every 2 m as its ground lays it, and matt. A scanned
        // rock's own photograph is an atlas of its islands, which a flat face cannot take.
        static Material Tablet()
        {
            const string Ground = "Assets/Kits/temperate/Terrain/dark_rock_02";
            return Made("temperate-tablet", "HDRP/Lit", material =>
            {
                material.SetTexture("_BaseColorMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Ground}_diff_2k.jpg"));
                material.SetTexture("_NormalMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Ground}_nor_gl_2k.jpg"));
                material.SetTexture("_MaskMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Ground}_arm_2k.jpg"));
                material.SetTextureScale("_BaseColorMap", new Vector2(0.5f, 0.5f));
                material.SetColor("_BaseColor", Color.white);
                material.SetFloat("_SmoothnessRemapMax", 0.35f);
            }, "Assets/Kits/temperate/Materials");
        }

        // A kit's loop (PRD v4 5.12), imported to load in the background (PRD v4 7.3.3: a loop's
        // data read and decompressed on the main thread as a world was built was one frame of
        // 73 ms, DEC-953), kept compressed in memory, and at no more than 48 kHz.
        static AudioClip KitAudio(string kit, string file)
        {
            string path = $"Assets/Kits/{kit}/Audio/{file}.ogg";
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path);
            if (clip == null)
            {
                throw new InvalidDataException($"the kit's loop {path} is not in the project: run Assets/Kits/{kit}/fetch.sh and git lfs pull");
            }
            var importer = (AudioImporter)AssetImporter.GetAtPath(path);
            AudioImporterSampleSettings settings = importer.defaultSampleSettings;
            bool fast = clip.frequency > 48000;
            if (!importer.loadInBackground || settings.loadType != AudioClipLoadType.CompressedInMemory || (fast && settings.sampleRateSetting != AudioSampleRateSetting.OverrideSampleRate))
            {
                importer.loadInBackground = true;
                settings.loadType = AudioClipLoadType.CompressedInMemory;
                if (fast)
                {
                    settings.sampleRateSetting = AudioSampleRateSetting.OverrideSampleRate;
                    settings.sampleRateOverride = 48000;
                }
                importer.defaultSampleSettings = settings;
                importer.SaveAndReimport();
                clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path);
            }
            return clip;
        }

        // Lava (PRD v4 5.6.3: Shiv's water): its crust a texture the world makes from noise and
        // moves (`LavaFlow`), which colours both its surface and its glow, so the cracks glow and
        // the crust is dark.
        static Material Lava()
        {
            const string Folder = "Assets/Kits/volcanic/Materials";
            return Made("volcanic-lava", "HDRP/Lit", material =>
            {
                material.SetColor("_BaseColor", Color.white);
                material.SetFloat("_Smoothness", 0.3f);
                material.SetFloat("_AlbedoAffectEmissive", 1);
                HDMaterial.SetUseEmissiveIntensity(material, true);
                HDMaterial.SetEmissiveColor(material, new Color(1f, 0.38f, 0.1f));
                HDMaterial.SetEmissiveIntensity(material, 13, EmissiveIntensityUnit.EV100);
            }, Folder);
        }

        static bool SetObject(GameObject wanted, GameObject held, System.Action<GameObject> assign)
        {
            if (wanted == held)
            {
                return false;
            }
            assign(wanted);
            return true;
        }

        // A kit prop as its prefab gives it (the prop conditioning rule, `PropRule`): the mesh, its
        // materials, and where the mesh stands in the prefab. No model file is read here: a model
        // becomes a prop in `KitPrefabs`, and the prefab is what the project draws.
        static KitProp PropOf(string prefabName, bool tree)
        {
            string path = KitPrefabs.Path("temperate", prefabName);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            MeshFilter[] filters = prefab == null ? new MeshFilter[0] : prefab.GetComponentsInChildren<MeshFilter>();
            // A prop cut to levels of its own draws them through a `LODGroup`, one mesh a level,
            // each standing where the first does.
            LOD[] levels = prefab == null || prefab.GetComponent<LODGroup>() == null ? new LOD[0] : prefab.GetComponent<LODGroup>().GetLODs();
            if (levels.Length > 0)
            {
                if (levels.Length != filters.Length || levels.Any(level => level.renderers.Length != 1 || level.renderers[0] == null))
                {
                    throw new InvalidDataException($"the kit's prop {path} has {levels.Length} levels for {filters.Length} meshes: one mesh a level");
                }
                filters = levels.Select(level => level.renderers[0].GetComponent<MeshFilter>()).ToArray();
                Transform first = filters[0].transform;
                if (filters.Any(filter => filter.transform.position != first.position || filter.transform.rotation != first.rotation || filter.transform.lossyScale != first.lossyScale))
                {
                    throw new InvalidDataException($"the levels of the kit's prop {path} do not stand in one place");
                }
            }
            else if (filters.Length != 1)
            {
                throw new InvalidDataException($"the kit's prop {path} is not a prefab of one mesh");
            }
            if (filters.Any(filter => filter == null || filter.sharedMesh == null))
            {
                throw new InvalidDataException($"the kit's prop {path} has a level with no mesh");
            }
            Transform model = filters[0].transform;
            bool upright = Quaternion.Angle(model.rotation, Quaternion.identity) < 0.01f;
            if (tree && !upright)
            {
                throw new InvalidDataException($"{path} is a tree whose mesh does not stand on its own y axis, and its trunk's capsule would not stand either");
            }
            return new KitProp
            {
                Mesh = filters[0].sharedMesh, Materials = filters[0].GetComponent<MeshRenderer>().sharedMaterials,
                Offset = model.position, Turn = upright ? Quaternion.identity : model.rotation, Scale = model.lossyScale.x,
                From = Mathf.FloorToInt(filters[0].GetComponent<MeshRenderer>().meshLodSelectionBias),
                First = levels.Length > 0 ? levels[0].screenRelativeTransitionHeight : 0,
                Levels = filters.Skip(1).Select((filter, i) => new KitLevel
                {
                    Mesh = filter.sharedMesh, Materials = filter.GetComponent<MeshRenderer>().sharedMaterials, Until = levels[i + 1].screenRelativeTransitionHeight,
                }).ToArray(),
            };
        }

        static bool Same(KitProp wanted, KitProp held) => held != null && wanted.Mesh == held.Mesh && held.Materials != null && wanted.Materials.SequenceEqual(held.Materials)
            && wanted.Offset == held.Offset && wanted.Turn == held.Turn && wanted.Scale == held.Scale && wanted.From == held.From
            && wanted.First == held.First && held.Levels != null && wanted.Levels.Length == held.Levels.Length
            && wanted.Levels.Zip(held.Levels, (level, other) => other != null && level.Mesh == other.Mesh && level.Until == other.Until
                && other.Materials != null && level.Materials.SequenceEqual(other.Materials)).All(same => same);

        public const string LayerFolder = "Assets/Kits/temperate/TerrainLayers";

        // The photographed ground of the kit's variants (`Assets/Kits/temperate/CREDITS.md`): each
        // texture is a terrain layer of its own name, at the size of its files and on a tile as
        // wide, in metres, as its source's page says the photograph is. The last figure is the
        // most gloss the layer draws: the top of the range its mask's smoothness is read into.
        // It is 1, the mask as it is, for every ground but `ground037`. That file's roughness is
        // 0.46 on average as ambientCG publishes it, where the six others' are 0.78 to 0.93, and
        // with the mask as it is the meadow shone toward the sun as one pale sheet (DEC-1055, B1).
        // At 0.25 its mean gloss is 0.13, the middle of the six others' 0.07 to 0.22.
        static readonly Dictionary<string, (string size, float metres, float gloss)> Photographed = new Dictionary<string, (string, float, float)>
        {
            ["ground037"] = ("1k", 2.1f, 0.25f), ["forrest_ground_01"] = ("2k", 2, 1), ["forest_leaves_03"] = ("2k", 2.3f, 1),
            ["brown_mud_leaves_01"] = ("2k", 1.3f, 1), ["mud_forest"] = ("2k", 2.3f, 1), ["dark_rock"] = ("2k", 2.4f, 1), ["dark_rock_02"] = ("2k", 2, 1),
        };

        // The top of the range a photographed ground's layer reads its mask's smoothness into.
        public static float GlossRange(string layer) => Photographed[layer].gloss;

        // The most gloss a variant's ground has, as `Gloss` measures it: dry ground is rough. The
        // glossiest of the photographs as they are is the wood's leaf litter, at 0.22.
        public const float GroundGloss = 0.25f;

        // A layer's gloss: the mean smoothness of its mask, read into the layer's own range. The
        // mean is taken from the mask's file: its roughness is the green of an `arm` file and the
        // grey of a `rough` file (`KitMaskImport`), and smoothness is one minus it.
        public static float Gloss(TerrainLayer layer)
        {
            string file = AssetDatabase.GetAssetPath(layer.maskMapTexture);
            var mask = new Texture2D(2, 2, TextureFormat.RGBA32, true, true);
            try
            {
                if (!mask.LoadImage(File.ReadAllBytes(file)))
                {
                    throw new InvalidDataException($"{file} is not a picture");
                }
                // The smallest level of a picture is about its mean, a little under it: each level of
                // the mip chain cuts its mean down to a whole number. For `ground037_rough_1k.jpg` it
                // reads a roughness of 113 of 255 where the file's mean is 118.0: about 0.02 more
                // smoothness than the file has. At a range of 1, the cap of 0.25 (`GroundGloss`) is
                // therefore about 0.23 of true gloss, and the test errs to the strict side.
                Color32 mean = mask.GetPixels32(mask.mipmapCount - 1)[0];
                float smoothness = 1 - (Path.GetFileName(file).Contains("_arm_") ? mean.g : mean.r) / 255f;
                return Mathf.Lerp(layer.maskMapRemapMin.w, layer.maskMapRemapMax.w, smoothness);
            }
            finally
            {
                Object.DestroyImmediate(mask);
            }
        }

        static TerrainLayer VariantLayer(string name)
        {
            var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>($"{LayerFolder}/{name}.terrainlayer");
            if (layer == null)
            {
                throw new InvalidDataException($"a variant names the terrain layer {name}, which the kit has not");
            }
            return layer;
        }

        // A terrain layer of the temperate kit: one texture's colour, normal and mask maps. The mask
        // is the kit's `arm` file, or its `rough` file where the source has no `arm`, as
        // `KitMaskImport` packs it, so the layer's smoothness and occlusion are the texture's own.
        static TerrainLayer KitLayer(string name, string texture, string size, float metres, Color tint, float gloss = 1)
        {
            string path = $"{LayerFolder}/{name}.terrainlayer";
            var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>(path);
            if (layer == null)
            {
                string Named(string kind) => $"Assets/Kits/temperate/Terrain/{texture}_{kind}_{size}.jpg";
                Texture2D Map(string kind)
                {
                    string file = Named(kind);
                    var map = AssetDatabase.LoadAssetAtPath<Texture2D>(file);
                    if (map == null)
                    {
                        throw new InvalidDataException($"the kit's texture {file} is not in the project: run Assets/Kits/temperate/fetch.sh and git lfs pull");
                    }
                    return map;
                }
                if (AssetImporter.GetAtPath(Named("nor_gl")) is TextureImporter normals && normals.textureType != TextureImporterType.NormalMap)
                {
                    normals.textureType = TextureImporterType.NormalMap;
                    normals.SaveAndReimport();
                }
                if (!AssetDatabase.IsValidFolder(LayerFolder))
                {
                    AssetDatabase.CreateFolder(Path.GetDirectoryName(LayerFolder), Path.GetFileName(LayerFolder));
                }
                layer = new TerrainLayer
                {
                    diffuseTexture = Map("diff"),
                    normalMapTexture = Map("nor_gl"),
                    maskMapTexture = Map(File.Exists(Named("arm")) ? "arm" : "rough"),
                    tileSize = new Vector2(metres, metres),
                    diffuseRemapMax = new Vector4(tint.r, tint.g, tint.b, 1),      // HDRP's terrain shader reads the tint here
                    maskMapRemapMax = new Vector4(1, 1, 1, gloss),                  // and the mask's smoothness, its alpha, into 0 to this
                };
                AssetDatabase.CreateAsset(layer, path);
                AssetDatabase.SaveAssets();
            }
            return layer;
        }

        static GameObject WaterPrefab(string kit, string name, WaterSurfaceType type)
        {
            string folder = $"Assets/Kits/{kit}/Water";
            Directory.CreateDirectory(folder);
            string path = $"{folder}/{name}.prefab";
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
            {
                var made = new GameObject(name);
                var surface = made.AddComponent<WaterSurface>();
                if (type == WaterSurfaceType.River)
                {
                    Preset(surface, "ApplyWaterRiverPreset");
                    // The water runs along the quad's long side, which is its own z (`WorldWater`),
                    // and the surface counts its angles from its own x.
                    surface.largeOrientationValue = 90;
                }
                else if (name == "Sea")
                {
                    // The open sea's preset, under a fresh breeze, with foam on its swell.
                    Preset(surface, "ApplyWaterOceanPreset");
                    surface.largeWindSpeed = 18;
                    surface.scriptInteractions = false;
                }
                else
                {
                    // The preset is an open sea's. For a lake 90 m across: a light breeze instead
                    // of 30 km/h, no foam, and nothing that reads the water's height from a script.
                    Preset(surface, "ApplyWaterOceanPreset");
                    surface.largeWindSpeed = 8;
                    surface.foam = false;
                    surface.scriptInteractions = false;
                }
                surface.geometryType = WaterGeometryType.Quad;
                prefab = PrefabUtility.SaveAsPrefabAsset(made, path);
                Object.DestroyImmediate(made);
            }
            return prefab;
        }

        // HDRP's own starting point for a kind of water surface: the preset its GameObject menu
        // applies, which is internal to the package. A component added from code gets none of it.
        // Its fields are then the class's initial values, which are an open sea's with no
        // current: a river made that way does not flow.
        static void Preset(WaterSurface surface, string preset)
        {
            System.Reflection.MethodInfo apply = typeof(WaterSurface).Assembly
                .GetType("UnityEngine.Rendering.HighDefinition.WaterSurfacePresets")
                ?.GetMethod(preset, System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
            if (apply == null)
            {
                throw new InvalidDataException($"this version of HDRP has no water preset named {preset}");
            }
            apply.Invoke(null, new object[] { surface });
        }

        static bool Set(Material wanted, Material held, System.Action<Material> assign)
        {
            if (wanted == held)
            {
                return false;
            }
            assign(wanted);
            return true;
        }

        // The slice's materials are plain colours until the kit's art replaces them: the plinth's is
        // the card's rarity in four steps (PRD v4 5.5.1), stone, bronze, silver and gold-veined.
        // Each is made once, under `Assets/Kits/core/Materials/` or its kit's folder, and then left
        // alone.
        internal static Material Lit(string name, Color colour, float metallic, float smoothness, string folder = MaterialFolder)
        {
            return Made(name, "HDRP/Lit", material =>
            {
                material.SetColor("_BaseColor", colour);
                material.SetFloat("_Metallic", metallic);
                material.SetFloat("_Smoothness", smoothness);
            }, folder);
        }

        // A rim's share of glow: its emission against the colour it shows (`Rim`).
        public const float RimGlow = 0.35f;

        // A rim's material: its class's colour, lit, and the same colour as an emission at
        // `RimGlow` of it that ignores the exposure (an exposure weight of 0).
        static Material Rim(string name, Color colour)
        {
            return Made(name, "HDRP/Lit", material =>
            {
                material.SetColor("_BaseColor", colour);
                material.SetFloat("_Metallic", 0);
                material.SetFloat("_Smoothness", 0.5f);
                material.SetFloat("_UseEmissiveIntensity", 0);
                material.SetColor("_EmissiveColor", colour.linear * RimGlow);
                material.SetColor("_EmissiveColorLDR", colour);
                material.SetFloat("_EmissiveExposureWeight", 0);
            });
        }

        // A world's ground draws instanced (`WorldGround`), and a build keeps a shader's instancing
        // variants only where a material asks for them: without them a player drew the terrain as
        // its flat patches, with no heights and no layers, where the editor drew it right.
        static Material Ground(string name, params string[] keywords)
        {
            Material ground = Made(name, "HDRP/TerrainLit", material => { });
            if (!keywords.All(ground.IsKeywordEnabled) || !ground.enableInstancing)
            {
                foreach (string keyword in keywords)
                {
                    ground.EnableKeyword(keyword);
                }
                ground.enableInstancing = true;
                EditorUtility.SetDirty(ground);
                AssetDatabase.SaveAssets();
            }
            return ground;
        }

        // `cutout`: the material draws nothing where its colour map's alpha is under a half.
        static Material Unlit(string name, Color colour, bool transparent, bool cutout = false)
        {
            return Made(name, "HDRP/Unlit", material =>
            {
                material.SetColor("_UnlitColor", colour);
                material.SetFloat("_SurfaceType", transparent ? 1 : 0);
                material.SetFloat("_AlphaCutoffEnable", cutout ? 1 : 0);
                material.SetFloat("_AlphaCutoff", 0.5f);
            });
        }

        static Material Made(string name, string shader, System.Action<Material> set, string folder = MaterialFolder)
        {
            Directory.CreateDirectory(folder);
            string path = $"{folder}/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find(shader)) { name = name };
                set(material);
                HDMaterial.ValidateMaterial(material);
                AssetDatabase.CreateAsset(material, path);
                AssetDatabase.SaveAssets();
            }
            return material;
        }

        // The repository's copy of a pack, which the pipeline commits (PRD v4 8.2.1).
        public static string RepositoryPack(string packHash) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", packHash));

        public static string ProjectPack(string packHash) => Path.Combine(Application.streamingAssetsPath, "data", packHash);

        public static WorldFiles.Result Build(string packHash, string slug)
        {
            WorldFiles.Result world = WorldFiles.Generate(RepositoryPack(packHash), ProjectPack(packHash), slug);
            AssetDatabase.Refresh();
            return world;
        }
    }
}
