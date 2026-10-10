using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // "The project opens with no console errors", as a command (DEC-951). Batchmode exits 0 from an
    // import that logged errors: a shader that does not parse, an asset that fails to import and an
    // exception in an editor script's static constructor all leave the exit code alone. Only a
    // script compile error ends the editor by itself. So the compile job runs this after the import
    // and it exits 1 if the editor's Console holds an error.
    //
    // The Console's store is `UnityEditor.LogEntries`, which is internal, so it is reached by
    // reflection. A member that an editor upgrade removed is an exception here, and the editor turns
    // an exception in an `-executeMethod` target into exit code 1: the check fails closed.
    //
    // The Console only holds what this editor session logged. An asset that is already in `Library/`
    // is not imported again, so its import errors are not repeated: the check is complete only when
    // the project is imported from cold, which is how CI runs it.
    public static class ConsoleCheck
    {
        // `UnityEditor.ConsoleWindow.Mode`, the bits the Console draws with its error icon.
        const int ErrorModes =
            1 << 0      // Error
            | 1 << 1    // Assert
            | 1 << 4    // Fatal
            | 1 << 6    // AssetImportError
            | 1 << 8    // ScriptingError
            | 1 << 11   // ScriptCompileError
            | 1 << 17   // ScriptingException
            | 1 << 20   // GraphCompileError
            | 1 << 21;  // ScriptingAssertion

        public static void Run()
        {
            Assembly editor = typeof(EditorApplication).Assembly;
            Type entries = editor.GetType("UnityEditor.LogEntries", throwOnError: true);

            object[] counts = { 0, 0, 0 };
            Method(entries, "GetCountsByType").Invoke(null, counts);
            int errors = (int)counts[0];
            Debug.Log($"ConsoleCheck: {errors} errors, {counts[1]} warnings, {counts[2]} messages");
            if (errors == 0)
            {
                return;
            }

            // The messages again, together, because in the log they are thousands of lines apart.
            Type entryType = editor.GetType("UnityEditor.LogEntry", throwOnError: true);
            FieldInfo message = entryType.GetField("message") ?? throw new MissingFieldException("LogEntry.message");
            FieldInfo mode = entryType.GetField("mode") ?? throw new MissingFieldException("LogEntry.mode");
            object entry = Activator.CreateInstance(entryType);
            int total = (int)Method(entries, "StartGettingEntries").Invoke(null, null);
            for (int row = 0; row < total; row++)
            {
                Method(entries, "GetEntryInternal").Invoke(null, new object[] { row, entry });
                if (((int)mode.GetValue(entry) & ErrorModes) != 0)
                {
                    Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null, "ConsoleCheck: error: {0}", message.GetValue(entry));
                }
            }
            Method(entries, "EndGettingEntries").Invoke(null, null);

            EditorApplication.Exit(1);
        }

        static MethodInfo Method(Type type, string name)
        {
            return type.GetMethod(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                ?? throw new MissingMethodException(type.FullName, name);
        }
    }
}
