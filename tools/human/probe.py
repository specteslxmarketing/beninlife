import bpy, sys, os
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
D = LocationService.get_user_data()
print("DATA", D)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
macro = TargetService.get_default_macro_info_dict()
macro.update({"gender": 1.0, "age": 0.5, "muscle": 0.6, "weight": 0.5, "height": 0.55, "proportions": 0.6})
macro["race"] = {"african": 1.0, "asian": 0.0, "caucasian": 0.0}
bm = HumanService.create_human(macro_detail_dict=macro)
print("BM", bm.name, len(bm.data.vertices), [m.name for m in bm.modifiers])
HumanService.add_builtin_rig(bm, "game_engine")
for name, typ in [("clothes/male_casualsuit06/male_casualsuit06.mhclo", "Clothes"), ("clothes/male_elegantsuit01/male_elegantsuit01.mhclo", "Clothes"), ("hair/short02/short02.mhclo", "Hair")]:
    o = HumanService.add_mhclo_asset(os.path.join(D, name), bm, asset_type=typ, subdiv_levels=0)
    print("ADDED", name, o.name if o else None)
for o in bpy.data.objects:
    print("OBJ", o.name, o.type, len(o.data.vertices) if o.type == 'MESH' else '', [m.name + ':' + m.type for m in o.modifiers], o.parent.name if o.parent else None)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
print("BONES", len(arm.data.bones), [b.name for b in arm.data.bones][:80])
print("VG", [g.name for g in bm.vertex_groups][:200])
