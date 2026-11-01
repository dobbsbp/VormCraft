# Third-party software

VormCraft (MIT licence, see [LICENSE](LICENSE)) includes the following open-source libraries in
its Windows app and web app. Each is used under its own licence, linked below.

| Library | Used for | Licence | Copyright |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) 0.186 | 3D display | MIT | © 2010–2026 three.js authors |
| [Manifold](https://github.com/elalish/manifold) 3.5 | Booleans (cutting solids) | Apache-2.0 | © The Manifold Authors |
| [earcut](https://github.com/mapbox/earcut) 3.2 | Triangulating faces | ISC | © Mapbox, Volodymyr Agafonkin |
| [fflate](https://github.com/101arrowz/fflate) 0.8 | Compressing design history; reading SketchUp files | MIT | © Arjun Barrett |
| [OpenSKP](https://github.com/iamahsanmehmood/openskp) 1.4.0 | Reading SketchUp (.skp) files | MIT | © Ahsan Mehmood |
| [FlatBuffers](https://github.com/google/flatbuffers) 25.9 | Reading SketchUp (.skp) files (used by OpenSKP) | Apache-2.0 | © Google Inc. |
| [Tauri](https://github.com/tauri-apps/tauri) 2 | The Windows app | Apache-2.0 or MIT | © Tauri Programme within The Commons Conservancy |

## MIT licence (three.js, fflate, OpenSKP)

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ISC licence (earcut)

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without
> fee is hereby granted, provided that the above copyright notice and this permission notice appear
> in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE.

## Apache License 2.0 (Manifold, FlatBuffers, Tauri)

The full text is at https://www.apache.org/licenses/LICENSE-2.0.

## SketchUp files

SketchUp is a trademark of Trimble Inc. VormCraft is an independent project and is not affiliated
with or endorsed by Trimble or SketchUp. SketchUp files are read with OpenSKP, an independent
open-source reader; some files (especially from older SketchUp versions) may not be read fully.
