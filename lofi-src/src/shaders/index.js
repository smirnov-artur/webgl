// GLSL lives in .glsl files so it stays readable in an editor and on GitHub.
// The two shared chunks are registered with three's own include system under
// namespaced keys, so every layer gets one copy of the maths and — more
// importantly — one copy of the scene layout. The composite needs to know
// exactly where the window opening is; having that constant in two places
// would guarantee the rain drifts off the glass.

import { ShaderChunk } from 'three';

import common from './common.glsl?raw';
import scene from './scene.glsl?raw';

import layerVert from './layer.vert.glsl?raw';
import skyFrag from './sky.frag.glsl?raw';
import cityFrag from './city.frag.glsl?raw';
import roofFrag from './roof.frag.glsl?raw';
import frameFrag from './frame.frag.glsl?raw';
import beamFrag from './beam.frag.glsl?raw';
import dustVert from './dust.vert.glsl?raw';
import dustFrag from './dust.frag.glsl?raw';
import compositeVert from './composite.vert.glsl?raw';
import compositeFrag from './composite.frag.glsl?raw';

ShaderChunk.lofi_common = common;
ShaderChunk.lofi_scene = scene;

export {
  layerVert,
  skyFrag,
  cityFrag,
  roofFrag,
  frameFrag,
  beamFrag,
  dustVert,
  dustFrag,
  compositeVert,
  compositeFrag,
};
