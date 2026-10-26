__all__ = ["create_led_screen"]

import json


def create_led_screen(display_name, resolution_x, resolution_y):
    import d3

    name = str(display_name).strip().lower()
    if not name:
        raise ValueError("The display name must contain a valid resource name.")
    for character in name:
        if not ("a" <= character <= "z" or "0" <= character <= "9" or character in "_-"):
            raise ValueError("The mesh name contains unsupported characters.")

    width = int(resolution_x)
    height = int(resolution_y)
    if width <= 0 or height <= 0:
        raise ValueError("The display resolution must be greater than zero.")

    mesh_path = "objects/meshfromobj/%s.obj" % name
    try:
        mesh = d3.resourceManager.load(d3.Path(mesh_path), d3.MeshFromObj)
    except Exception as error:
        return json.dumps({
            "ok": False,
            "pending": True,
            "error": "Designer is not ready to load the exported OBJ at %s: %s" % (mesh_path, str(error)),
        })

    if mesh is None or len(mesh.verts) == 0 or len(mesh.triangles) == 0:
        return json.dumps({
            "ok": False,
            "pending": True,
            "error": "Designer loaded no valid geometry from %s." % mesh_path,
        })

    screen_path = "objects/ledscreen/%s.apx" % name
    screen = d3.resourceManager.loadOrCreate(d3.Path(screen_path), d3.LedScreen)
    screen.mesh = mesh
    screen.resolution = d3.Vec2(width, height)

    stage = d3.state.stage
    screens = list(stage.ledScreens)
    if screen not in screens:
        screens.append(screen)
        stage.ledScreens = screens

    screen.save()
    return json.dumps({
        "ok": True,
        "name": str(screen.description),
        "resolution": [width, height],
        "mesh": mesh_path,
    })
