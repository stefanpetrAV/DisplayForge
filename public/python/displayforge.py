"""DisplayForge helper module for disguise Designer.

Registered by the plugin through /api/session/python/registermodule and called
through /api/session/python/execute. Every function returns a JSON string.
"""

__all__ = [
    "create_led_screen",
    "save_obj",
    "save_population_mask",
    "load_state",
    "save_state",
    "project_info",
]

import base64
import json
import os

STATE_FOLDER = "displayforge"
STATE_FILE = "screens.json"

# Designer's own resource folders. DisplayForge writes its files straight into
# these with Python instead of going through the browser download: Designer's
# download handler files every downloaded .obj under objects/meshfromobj,
# a folder that must not exist in the project.
MESH_FOLDER = "Mesh"
TEXTURE_FOLDER = "DxTexture"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _valid_name(display_name):
    name = str(display_name).strip().lower()
    if not name:
        raise ValueError("The display name must contain a valid resource name.")
    for character in name:
        if not ("a" <= character <= "z" or "0" <= character <= "9" or character in "_-"):
            raise ValueError("The mesh name contains unsupported characters.")
    return name


def _objects_subfolder(wanted, create):
    """(absolute folder, project-relative prefix) of objects/<wanted>, matched case-insensitively.

    Returns (None, None) when the project folder is unknown, or when the folder
    does not exist and `create` is False.
    """
    project = _project_folder()
    if project is None:
        return None, None
    objects = os.path.join(project, "objects")
    for entry in os.listdir(objects):
        if entry.lower() == wanted.lower() and os.path.isdir(os.path.join(objects, entry)):
            return os.path.join(objects, entry), "objects/%s" % entry
    if not create:
        return None, None
    folder = os.path.join(objects, wanted)
    os.makedirs(folder)
    return folder, "objects/%s" % wanted


def _existing_spelling(folder, file_name):
    """Keep the on-disk spelling of a file that already exists (case-insensitive match)."""
    for candidate in os.listdir(folder):
        if candidate.lower() == file_name.lower():
            return candidate
    return file_name


def _write_file(path, data):
    """Write bytes through a temporary file so Designer never sees a half-written file."""
    temp_path = path + ".partial"
    with open(temp_path, "wb") as handle:
        handle.write(data)
    if os.path.exists(path):
        os.remove(path)
    os.rename(temp_path, path)


def _load_fresh(relative_path, resource_type):
    """Load the resource at an existing path; re-read the file if Designer had it loaded already."""
    import d3

    resource = d3.resourceManager.load(d3.Path(relative_path), resource_type)
    if resource is not None:
        try:
            resource.reloadExternal()
        except Exception:
            pass
    return resource


def _find_mesh_path(name):
    """Project-relative path of <name>.obj in objects/Mesh, or None if it is not there yet."""
    import d3

    file_name = "%s.obj" % name
    if _project_folder() is not None:
        folder, prefix = _objects_subfolder(MESH_FOLDER, False)
        if folder is None:
            return None
        for candidate in os.listdir(folder):
            if candidate.lower() == file_name:
                return "%s/%s" % (prefix, candidate)
        return None
    # Project folder unknown: ask Designer whether the resource file exists.
    for path in ("objects/Mesh/%s" % file_name, "objects/mesh/%s" % file_name):
        try:
            if d3.resourceManager.exists(d3.Path(path)):
                return path
        except Exception:
            pass
    return None


def create_led_screen(display_name, resolution_x, resolution_y):
    import d3

    name = _valid_name(display_name)
    width = int(resolution_x)
    height = int(resolution_y)
    if width <= 0 or height <= 0:
        raise ValueError("The display resolution must be greater than zero.")

    # save_obj writes the OBJ into <project>/objects/Mesh. Never load from a
    # path that does not exist yet: Designer would register a resource there
    # and create the folder.
    mesh_path = _find_mesh_path(name)
    if mesh_path is None:
        return json.dumps({
            "ok": False,
            "pending": True,
            "error": "%s.obj is not in the project's objects/Mesh folder yet." % name,
        })
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


def save_obj(display_name, text):
    """Write <name>.obj into the project's objects/Mesh folder (never objects/meshfromobj)."""
    import d3

    name = _valid_name(display_name)
    folder, prefix = _objects_subfolder(MESH_FOLDER, True)
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    file_name = _existing_spelling(folder, "%s.obj" % name)
    _write_file(os.path.join(folder, file_name), text.encode("utf-8"))
    relative = "%s/%s" % (prefix, file_name)
    try:
        _load_fresh(relative, d3.MeshFromObj)
    except Exception:
        pass  # create_led_screen retries the load
    return json.dumps({"ok": True, "path": relative})


def save_population_mask(screen_name, file_name, png_base64, assign):
    """Write objects/DxTexture/<file_name>.png and, if `assign`, set it as the
    population mask of objects/ledscreen/<screen_name>.apx."""
    import d3

    screen_name = _valid_name(screen_name)
    file_name = _valid_name(file_name)
    data = base64.b64decode(png_base64)
    if data[:8] != PNG_SIGNATURE:
        raise ValueError("The population mask is not a PNG image.")

    folder, prefix = _objects_subfolder(TEXTURE_FOLDER, True)
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    png_name = _existing_spelling(folder, "%s.png" % file_name)
    _write_file(os.path.join(folder, png_name), data)
    relative = "%s/%s" % (prefix, png_name)
    result = {"ok": True, "path": relative, "assigned": False}
    if not assign:
        return json.dumps(result)

    screen_path = "objects/ledscreen/%s.apx" % screen_name
    if not d3.resourceManager.exists(d3.Path(screen_path)):
        result["ok"] = False
        result["error"] = "Mask saved as %s, but the LED screen %s does not exist yet: create it first." % (relative, screen_name)
        return json.dumps(result)
    texture = _load_fresh(relative, d3.DxTexture)
    if texture is None:
        result["ok"] = False
        result["error"] = "Mask saved as %s, but Designer could not load it." % relative
        return json.dumps(result)
    screen = d3.resourceManager.load(d3.Path(screen_path), d3.LedScreen)
    screen.population_mask = texture
    screen.save()
    result["assigned"] = True
    result["screen"] = str(screen.description)
    try:
        result["screenResolution"] = [int(screen.resolution.x), int(screen.resolution.y)]
    except Exception:
        pass
    return json.dumps(result)


# --------------------------------------------------------------------------
# Project-side storage of the DisplayForge screens
# --------------------------------------------------------------------------

def _candidate_project_folders():
    import d3

    candidates = []
    # 1. Resolve a project-relative path through Designer itself.
    try:
        probe = d3.Path("objects/ledscreen/displayforge-probe.apx")
        directory = str(probe.directory)
        if directory:
            candidates.append(os.path.dirname(os.path.dirname(os.path.normpath(directory))))
    except Exception:
        pass
    # 2. The stage resource lives inside the project folder.
    try:
        stage_dir = str(d3.state.stage.path.directory)
        if stage_dir:
            folder = os.path.normpath(stage_dir)
            while folder and os.path.basename(folder).lower() != "objects":
                parent = os.path.dirname(folder)
                if parent == folder:
                    folder = ""
                    break
                folder = parent
            if folder:
                candidates.append(os.path.dirname(folder))
    except Exception:
        pass
    # 3. Designer normally runs with the project folder as working directory.
    try:
        candidates.append(os.getcwd())
    except Exception:
        pass
    return candidates


def _project_folder():
    for folder in _candidate_project_folders():
        if folder and os.path.isabs(folder) and os.path.isdir(os.path.join(folder, "objects")):
            return folder
    return None


def _state_path():
    folder = _project_folder()
    if folder is None:
        return None, None
    return folder, os.path.join(folder, STATE_FOLDER, STATE_FILE)


def project_info():
    folder, path = _state_path()
    return json.dumps({"ok": folder is not None, "projectFolder": folder, "stateFile": path})


def load_state():
    folder, path = _state_path()
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    if not os.path.isfile(path):
        return json.dumps({"ok": True, "projectFolder": folder, "data": None})
    with open(path, "r") as handle:
        text = handle.read()
    try:
        data = json.loads(text)
    except ValueError as error:
        return json.dumps({"ok": False, "projectFolder": folder, "error": "Invalid %s: %s" % (path, error)})
    return json.dumps({"ok": True, "projectFolder": folder, "data": data})


def save_state(text):
    folder, path = _state_path()
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    json.loads(text)  # refuse to write invalid JSON
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        os.makedirs(directory)
    temp_path = path + ".tmp"
    with open(temp_path, "w") as handle:
        handle.write(text)
    if os.path.exists(path):
        os.remove(path)
    os.rename(temp_path, path)
    return json.dumps({"ok": True, "projectFolder": folder, "stateFile": path})
