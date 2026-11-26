# Cuts the soundtrack into beat-grid loops: 5 danger levels (4 bars each, 99.77 BPM, grid from the first note at
# 0.1394 s) and the end song (8.018 s). Each level takes its last 200 ms from two bars earlier (no bleed from the next
# part) and blends its last 6 ms into the samples that precede its first sample, so the wrap is continuous. Needs numpy.
import numpy as np, wave, sys
OUT=sys.argv[1]  # usage: python build_loops.py <out dir> <full soundtrack .wav, 44.1 kHz stereo>
w=wave.open(sys.argv[2]); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).reshape(-1,2).astype(np.float64)/32768
T=lambda t:int(round(t*sr))
t0=0.1394; P2=4.8110; P4=2*P2; PRE=0.025
def xfade(a,b,n):
    # equal-power crossfade from a into b over n samples (a,b same length n)
    r=np.linspace(0,1,n)[:,None]; return a*np.cos(r*np.pi/2)+b*np.sin(r*np.pi/2)
def patch(loop, i0, src, n_fade):
    """replace loop[i0:] with src (same length) using a short crossfade at i0"""
    L=len(loop)-i0; out=loop.copy()
    out[i0:i0+n_fade]=xfade(loop[i0:i0+n_fade],src[:n_fade],n_fade); out[i0+n_fade:]=src[n_fade:L]
    return out
def write(name, y):
    y=np.clip(y,-1,1); ww=wave.open(f"{OUT}/{name}.wav","wb"); ww.setnchannels(2); ww.setsampwidth(2); ww.setframerate(sr)
    ww.writeframes((y*32767).astype(np.int16).tobytes()); ww.close()
    jump=np.abs(y[0]-y[-1]).max(); print(f"{name}: {len(y)/sr:.4f}s  wrap jump {jump:.4f}  start {np.abs(y[:T(.03)]).mean():.3f} end {np.abs(y[-T(.03):]).mean():.3f} mid {np.abs(y[len(y)//2:len(y)//2+T(.03)]).mean():.3f}")
n4=T(P4); nP2=T(P2); tail=T(0.200); f5=T(0.005)
for k in range(5):
    s=T(t0+k*P4-PRE)
    loop=x[s:s+n4].copy()
    # tail: the next level's hit bleeds in early -> use the same bar position two bars earlier
    loop=patch(loop, n4-tail, x[s+n4-tail-nP2 : s+n4-nP2], T(0.012))
    if k==0:
        # head: the video starts with silence before the first note -> pre-roll from two bars later
        pre=T(PRE)+T(0.004)
        head=x[s+nP2 : s+nP2+pre]
        loop[:pre]=xfade(head, loop[:pre], pre) if False else np.concatenate([head[:pre-f5], xfade(head[pre-f5:], loop[pre-f5:pre], f5)])
    # seamless wrap: blend the last 4 ms toward the audio that precedes a downbeat of this same level
    # the audio that leads into loop[0] (level 1's head was rebuilt from two bars later)
    n=T(0.006); lead=x[s+nP2-n : s+nP2] if k==0 else x[s-n:s]
    loop[-n:]=xfade(loop[-n:], lead, n)
    write(f"level{k+1}", loop)
# END: phrase of 2 x 4.009 s; the video stops 0.114 s short, so rebuild the tail from 4.009 s earlier
E=T(t0+5*P4-PRE); PE=4.009; nE=T(2*PE); have=len(x)-E
end=np.zeros((nE,2)); end[:have]=x[E:]
miss=nE-have; src=x[len(x)-T(PE) - 0 : len(x)-T(PE)+miss] if False else end[have-T(PE):have-T(PE)+miss]
# crossfade 10 ms before the video end into the material from one 2-bar period earlier
nf=T(0.010); j=have-nf
fill=end[j-T(PE): j-T(PE)+nf+miss]
end[j:j+nf]=xfade(end[j:j+nf],fill[:nf],nf); end[j+nf:]=fill[nf:]
n=T(0.006); lead=x[E-n:E]
end[-n:]=xfade(end[-n:],lead,n)
write("end", end)
