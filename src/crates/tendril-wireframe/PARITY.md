# Checking this crate against V1

The wireframe port has a real reference implementation to be checked against: `Ivy.Tendril.Wireframe`
in the `Ivy-Interactive/Ivy-Tendril` repository, pinned for this port at `c146947c` (PR #2711).

Tests that assert behaviour are not enough on their own. They passed on the agent reference while the
output still differed, and they would never have caught an ordering or whitespace change. Diffing the
two implementations' actual output does catch it, and it is cheap: the V1 wireframe project is a
self-contained library that builds in about three seconds, with no need for the rest of the solution.

## Diffing the agent reference

Point `V1` at a checkout of V1 at the pinned commit, then build a runner against its library:

```xml
<!-- v1runner/v1runner.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(V1)/src/Ivy.Tendril.Wireframe/Ivy.Tendril.Wireframe.csproj" />
  </ItemGroup>
</Project>
```

```csharp
// v1runner/Program.cs -- writes UTF-8 bytes to a file, never to the console
using System.Text;
using Ivy.Tendril.Wireframe.Assets;
using Ivy.Tendril.Wireframe.Manifest;

var assets = AssetCatalog.Default;
var manifest = ComponentManifest.Load(assets);
var renderer = new AgentReadmeRenderer(manifest, VendorManifest.Load(assets));
var text = args.Length > 2 && args[1] == "component"
    ? renderer.RenderComponent(manifest.Find(args[2])!)
    : renderer.Render();
File.WriteAllBytes(args[0], new UTF8Encoding(false).GetBytes(text));
```

```bash
dotnet build v1runner -v q --nologo
./v1runner/bin/Debug/net10.0/v1runner v1.md
cargo run -q -p tendril-wireframe --example dump-readme > v2.md
```

Then compare with newlines normalised (see below), not with a plain `diff`:

```bash
node -e "const f=require('fs');const a=f.readFileSync('v1.md','utf8').split('\r\n').join('\n');
         console.log(a===f.readFileSync('v2.md','utf8') ? 'IDENTICAL' : 'DIFFERS')"
```

As of the port, both the full reference (55,720 characters) and a component detail view are
identical.

**Write to a file, not to stdout.** The Windows console codepage mangles `·` and every other
non-ASCII character on redirect, which shows up as a difference that is not real. That cost one
false alarm already.

## The one deliberate deviation: newlines

V1 builds these documents with `StringBuilder.AppendLine`, which emits `Environment.NewLine`. Its
output is therefore CRLF on Windows and LF on macOS and Linux -- the same renderer, the same
manifest, two different documents depending on the machine.

This crate always emits LF. That matches V1 on the platforms the team develops on, and it makes the
output reproducible everywhere, which matters because the agent reference is fed into prompts and
diffed between releases.

So a comparison must normalise newlines before it means anything. Everything else is byte for byte.
