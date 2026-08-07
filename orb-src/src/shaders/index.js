// GLSL is kept in .glsl files rather than template literals so it stays
// readable on GitHub and in an editor with syntax highlighting. The noise
// chunk is registered with three's own include system under a namespaced key,
// so both stages share one copy instead of two pasted ones.

import { ShaderChunk } from 'three';

import orbNoise from './noise.glsl?raw';
import orbVert from './orb.vert.glsl?raw';
import orbFrag from './orb.frag.glsl?raw';
import backfaceFrag from './backface.frag.glsl?raw';
import haloVert from './halo.vert.glsl?raw';
import haloFrag from './halo.frag.glsl?raw';
import dustVert from './dust.vert.glsl?raw';
import dustFrag from './dust.frag.glsl?raw';

ShaderChunk.orb_noise = orbNoise;

export { orbVert, orbFrag, backfaceFrag, haloVert, haloFrag, dustVert, dustFrag };
