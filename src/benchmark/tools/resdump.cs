#:property PublishAot=false
#:property TreatWarningsAsErrors=false
#:property InvariantGlobalization=true

// Dumps the embedded manifest resources of .NET assemblies, byte for byte, for the size suite.
//
//   dotnet run src/benchmark/tools/resdump.cs -- <outDir> <assembly.dll>...
//
// V1 ships its frontend (the Ivy framework bundle, the Tendril widgets bundle, fonts, source maps)
// as manifest resources inside Ivy.dll and Ivy.Tendril.Widgets.dll, which themselves live inside the
// Ivy.Tendril single-file bundle. The suite extracts those DLLs from the bundle and hands them here.
//
// This reads the metadata tables with System.Reflection.Metadata instead of loading the assembly:
// nothing is resolved or executed, so a DLL built for a newer runtime, or one whose dependencies are
// missing, still dumps. Each resource is written to <outDir>/<n>.bin (resource names are not
// guaranteed to be valid file names) and described in <outDir>/manifest.json with its size and
// SHA-256, which the suite re-checks against the file it reads back.

using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: resdump <outDir> <assembly.dll>...");
    return 2;
}

var outDir = Path.GetFullPath(args[0]);
Directory.CreateDirectory(outDir);
var assemblies = new JsonArray();
var n = 0;

foreach (var dll in args.Skip(1))
{
    var entry = new JsonObject { ["file"] = Path.GetFullPath(dll) };
    assemblies.Add(entry);
    using var stream = File.OpenRead(dll);
    using var pe = new PEReader(stream, PEStreamOptions.PrefetchEntireImage);
    if (!pe.HasMetadata)
    {
        entry["error"] = "not a managed assembly";
        continue;
    }
    var md = pe.GetMetadataReader();
    entry["assembly"] = md.IsAssembly ? md.GetString(md.GetAssemblyDefinition().Name) : null;
    var resourcesRva = pe.PEHeaders.CorHeader!.ResourcesDirectory.RelativeVirtualAddress;
    var resources = new JsonArray();
    entry["resources"] = resources;

    foreach (var handle in md.ManifestResources)
    {
        var res = md.GetManifestResource(handle);
        var name = md.GetString(res.Name);
        // A non-nil Implementation points at another file or assembly: nothing is embedded here.
        if (!res.Implementation.IsNil)
        {
            resources.Add(new JsonObject { ["name"] = name, ["embedded"] = false });
            continue;
        }
        // ECMA-335 II.24.2.4: the resource is a 4-byte little-endian length followed by the bytes,
        // at Offset from the start of the CLI header's Resources directory.
        var reader = pe.GetSectionData(resourcesRva + (int)res.Offset).GetReader();
        var length = reader.ReadInt32();
        var bytes = reader.ReadBytes(length);
        var file = $"{n++}.bin";
        File.WriteAllBytes(Path.Combine(outDir, file), bytes);
        resources.Add(new JsonObject
        {
            ["name"] = name,
            ["embedded"] = true,
            ["size"] = bytes.Length,
            ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(bytes)),
            ["file"] = file,
            ["public"] = (res.Attributes & System.Reflection.ManifestResourceAttributes.VisibilityMask) == System.Reflection.ManifestResourceAttributes.Public,
        });
    }
}

var manifest = new JsonObject { ["tool"] = "resdump", ["runtime"] = Environment.Version.ToString(), ["assemblies"] = assemblies };
File.WriteAllText(Path.Combine(outDir, "manifest.json"), manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"resdump: {n} resource(s) from {args.Length - 1} assembly(ies) -> {outDir}");
return 0;
