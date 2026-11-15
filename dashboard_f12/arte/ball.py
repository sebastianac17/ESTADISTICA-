import numpy as np
from PIL import Image
phi=(1+5**.5)/2
ico=np.array([[-1,phi,0],[1,phi,0],[-1,-phi,0],[1,-phi,0],[0,-1,phi],[0,1,phi],[0,-1,-phi],[0,1,-phi],[phi,0,-1],[phi,0,1],[-phi,0,-1],[-phi,0,1]],float)
ico/=np.linalg.norm(ico,axis=1)[:,None]
# icosahedron faces -> hexagon centers
faces=[]
for i in range(12):
    for j in range(i+1,12):
        for k in range(j+1,12):
            if all(np.dot(ico[a],ico[b])>0.4 for a,b in [(i,j),(j,k),(i,k)]): faces.append((i,j,k))
hexc=np.array([ico[list(f)].sum(0) for f in faces]); hexc/=np.linalg.norm(hexc,axis=1)[:,None]
C=np.vstack([ico,hexc]); ispent=np.r_[np.ones(12,bool),np.zeros(20,bool)]
S=80; SS=4; R=S*SS
def rot(ax,a):
    ax=np.array(ax,float); ax/=np.linalg.norm(ax); x,y,z=ax; c,s=np.cos(a),np.sin(a)
    return np.array([[c+x*x*(1-c),x*y*(1-c)-z*s,x*z*(1-c)+y*s],[y*x*(1-c)+z*s,c+y*y*(1-c),y*z*(1-c)-x*s],[z*x*(1-c)-y*s,z*y*(1-c)+x*s,c+z*z*(1-c)]])
yy,xx=np.mgrid[0:R,0:R]; u=(xx+.5)/R*2-1; v=-((yy+.5)/R*2-1)
r2=u*u+v*v; inside=r2<=1; w=np.sqrt(np.clip(1-r2,0,1))
P=np.stack([u,v,w],-1)  # view space normal
L=np.array([-.45,.62,.64]); L/=np.linalg.norm(L)
H=(L+np.array([0,0,1])); H/=np.linalg.norm(H)
ndl=np.clip(P@L,0,1); spec=np.clip(P@H,0,1)**38
rng=np.random.default_rng(3); grain=rng.normal(0,1,(R,R))
base_tilt=rot([1,0,0],0.35)@rot([0,0,1],0.2)
frames=[]
N=16
for f in range(N):
    M=rot([0.15,0.2,1],-2*np.pi*f/N)@base_tilt  # spin around near-view axis -> rolls to the right
    Q=P@M  # object-space points
    d=Q@C.T
    d[:,:,:12]-=0.014   # enlarge pentagons slightly
    idx=np.argsort(-d,axis=2)
    b1=np.take_along_axis(d,idx[:,:,:1],2)[...,0]; b2=np.take_along_axis(d,idx[:,:,1:2],2)[...,0]
    pent=ispent[idx[:,:,0]]
    gap=b1-b2
    seam=np.clip(1-gap/0.012,0,1)          # 1 at seam
    pillow=np.clip(gap/0.09,0,1)**.5       # panel bulge
    albedo=np.where(pent,0.10,0.94)
    # subtle panel tint for white: cool white
    col=np.stack([albedo*1.0,albedo*1.0,albedo*1.02],-1)
    shade=0.36+0.74*ndl*(0.82+0.18*pillow)
    rim=np.clip(1-w,0,1)**3*0.35
    c=col*shade[...,None]
    c=c*(1-0.55*seam[...,None])
    c+= (spec*(0.55+0.45*pillow)*(np.where(pent,0.6,1.0)))[...,None]
    c-= rim[...,None]*0.6
    c+= grain[...,None]*0.012
    c=np.clip(c,0,1)
    a=inside.astype(float)
    img=np.dstack([c*255,a[...,None]*255]).astype(np.uint8)
    im=Image.fromarray(img,'RGBA').resize((S,S),Image.LANCZOS)
    frames.append(im)
sheet=Image.new('RGBA',(S*N,S))
for i,im in enumerate(frames): sheet.paste(im,(i*S,0))
sheet.save('ball_sheet.webp',quality=88,method=6)
sheet.save('ball_sheet.png')
frames[0].resize((240,240),Image.LANCZOS).save('ball_preview.png')
import os; print(os.path.getsize('ball_sheet.webp'))
