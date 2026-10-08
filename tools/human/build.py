# Headless Blender + MPFB2 (MakeHuman for Blender) character build -> client/public/models/{male,female}.glb
# All inputs are CC0 (MakeHuman base mesh, game_engine rig + weights, system assets pack). See ASSETS_LICENSES.md.
import bpy, bmesh, os, sys
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

D = LocationService.get_user_data()
OUT = sys.argv[sys.argv.index('--') + 1]
P = lambda *a: os.path.join(D, *a)

def img_sampler(path):
    im = bpy.data.images.load(path); w, h = im.size; px = im.pixels[:]
    def s(u, v):
        x = min(w - 1, max(0, int((u % 1) * w))); y = min(h - 1, max(0, int((v % 1) * h))); i = (y * w + x) * 4
        return px[i], px[i + 1], px[i + 2]
    return s

def bake_shapekeys(o):
    if o.data.shape_keys:
        o.shape_key_add(name='mix', from_mix=True)
        mix = o.data.shape_keys.key_blocks['mix']
        co = [v.co.copy() for v in mix.data]
        for kb in list(o.data.shape_keys.key_blocks): o.shape_key_remove(kb)
        for v, c in zip(o.data.vertices, co): v.co = c

def evaluated_copy(o, name, keep_masks):
    """copy of o with only the listed mask modifiers (+ helpers mask) applied, armature kept as a modifier"""
    for m in o.modifiers:
        if m.type == 'MASK': m.show_viewport = (m.name == 'Hide helpers') or (m.name in keep_masks)
        if m.type == 'ARMATURE': m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    n = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(n)
    for g in o.vertex_groups: n.vertex_groups.new(name=g.name)
    n.parent = o.parent; n.matrix_world = o.matrix_world.copy()
    a = n.modifiers.new('Armature', 'ARMATURE'); a.object = o.parent
    for m in o.modifiers:
        if m.type == 'ARMATURE': m.show_viewport = True
    return n

def components(bm):
    comp = {}; cid = 0
    for f in bm.faces:
        if f.index in comp: continue
        stack = [f]; comp[f.index] = cid
        while stack:
            g = stack.pop()
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in comp: comp[h.index] = cid; stack.append(h)
        cid += 1
    return comp, cid

def split_copy(o, name, keep_face, frac=0.5):
    n = o.copy(); n.data = o.data.copy(); n.name = name; bpy.context.scene.collection.objects.link(n)
    bm = bmesh.new(); bm.from_mesh(n.data); uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    comp, nc = components(bm)
    votes = [0] * nc; tot = [0] * nc
    for f in bm.faces: tot[comp[f.index]] += 1; votes[comp[f.index]] += 1 if keep_face(f, uvl) else 0
    print('SPLIT', name, nc, 'components', [(t, v) for t, v in zip(tot, votes)][:20])
    kill = [f for f in bm.faces if votes[comp[f.index]] < frac * tot[comp[f.index]]]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(n.data); bm.free(); return n

def face_uv(f, uvl):
    u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops); v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops); return u, v

def build(gender):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    macro = TargetService.get_default_macro_info_dict()
    if gender == 'male': macro.update({'gender': 1.0, 'age': 0.5, 'muscle': 0.62, 'weight': 0.52, 'height': 0.58, 'proportions': 0.7})
    else: macro.update({'gender': 0.0, 'age': 0.48, 'muscle': 0.5, 'weight': 0.55, 'height': 0.5, 'proportions': 0.7, 'cupsize': 0.55, 'firmness': 0.6})
    macro['race'] = {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}
    bm = HumanService.create_human(macro_detail_dict=macro)
    HumanService.add_builtin_rig(bm, 'game_engine')
    rig = bm.parent
    add = lambda rel, typ: HumanService.add_mhclo_asset(P(*rel.split('/')), bm, asset_type=typ, subdiv_levels=0)
    eyes = add('eyes/low-poly/low-poly.mhclo', 'Eyes')
    brows = add('eyebrows/eyebrow001/eyebrow001.mhclo', 'Eyebrows')
    lashes = add('eyelashes/eyelashes01/eyelashes01.mhclo', 'Eyelashes')
    if gender == 'male':
        hair = add('hair/short02/short02.mhclo', 'Hair')
        shoes = add('clothes/shoes04/shoes04.mhclo', 'Clothes')
        outfits = {'tee': 'male_casualsuit06', 'shirt': 'male_casualsuit03', 'suit': 'male_elegantsuit01'}
    else:
        hair = add('hair/afro01/afro01.mhclo', 'Hair')
        shoes = add('clothes/shoes04/shoes04.mhclo', 'Clothes')
        outfits = {'blouse': 'female_elegantsuit01'}
    cloth = {k: add(f'clothes/{v}/{v}.mhclo', 'Clothes') for k, v in outfits.items()}
    for o in [bm, eyes, brows, lashes, hair, shoes, *cloth.values()]: bake_shapekeys(o)
    keep = []
    shoe_mask = [m.name for m in bm.modifiers if m.type == 'MASK' and 'shoes' in m.name]
    for k, v in outfits.items():
        masks = shoe_mask + [m.name for m in bm.modifiers if m.type == 'MASK' and m.name.endswith(v)]
        keep.append(evaluated_copy(bm, f'Body_{k}', masks))

    # garments: split casual suits into top + bottom by texture colour under each face (jeans/skirt vs top)
    for k, v in outfits.items():
        o = cloth[k]
        if k == 'suit': o.name = 'Cloth_suit'; keep.append(o); continue
        samp = img_sampler(P('clothes', v, f'{v}_diffuse.png'))
        def is_bottom(f, uvl, samp=samp, k=k):
            r, g, b = samp(*face_uv(f, uvl))
            if gender == 'female' and k == 'blouse': return not (r > b + 0.08)  # grey skirt vs red-striped blouse
            return b > r + 0.05  # blue denim
        fr = 0.12 if gender == 'female' else 0.5  # striped blouse: any notable red share = top
        keep.append(split_copy(o, f'Cloth_{k}_top', lambda f, uvl: not is_bottom(f, uvl), fr))
        keep.append(split_copy(o, f'Cloth_{k}_bottom', is_bottom, 1 - fr + 1e-6))
    for o, n in [(eyes, 'Eyes'), (brows, 'Brows'), (lashes, 'Lashes'), (hair, 'Hair'), (shoes, 'Shoes')]: o.name = n; keep.append(o)
    # drop everything else
    for o in list(bpy.data.objects):
        if o not in keep and o != rig: bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep + [rig]: o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for o in keep: print('MESH', o.name, len(o.data.vertices), len(o.data.polygons))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'{gender}.glb'), export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=False, export_materials='NONE', export_apply=False, export_yup=True, export_morph=False)

for g in ('male', 'female'): build(g)
print('DONE')
