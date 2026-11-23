"""DisplayForge helper module for disguise Designer.

Registered by the plugin through /api/session/python/registermodule and called
through /api/session/python/execute. Every function returns a JSON string.
"""

__all__ = [
    "create_led_screen",
    "save_obj",
    "save_population_mask",
    "save_test_pattern",
    "list_meshes",
    "read_mesh",
    "load_state",
    "save_state",
    "project_info",
    "upload_chunk",
    "take_upload",
]

import base64
import io
import json
import tempfile

# Designer runs plugin code with its own globals, where the name "os" is a
# Designer object (d3.OS) that shadows the standard module: _os.path raises
# "'OS' object has no attribute 'path'". Use a private alias, which star
# imports and injected globals never overwrite.
import os as _os

# The screens are saved next to the plugin's own files when the plugin is
# installed inside the project (<project>/plugins/<folder>), so DisplayForge
# adds no folder of its own to the project. LEGACY_STATE_FOLDER is the
# fallback (plugin installed outside the project) and the 0.8.x
# location, migrated on the first save.
LEGACY_STATE_FOLDER = "displayforge"
STATE_FILE = "screens.json"
PLUGIN_NAME = "DisplayForge"
PLUGIN_MANIFEST = "d3plugin.json"

# Designer's own resource folders. DisplayForge writes its files straight into
# these with Python instead of going through the browser download: Designer's
# download handler files every downloaded .obj under objects/meshfromobj,
# a folder that must not exist in the project.
MESH_FOLDER = "Mesh"
TEXTURE_FOLDER = "DxTexture"
VIDEO_FOLDER = "VideoFile"
TEST_PATTERN_FOLDER = "TestPattern"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


# --------------------------------------------------------------------------
# Chunked uploads: Designer's web server answers HTTP 413 to large requests,
# so big payloads (test patterns, masks, OBJ text) are sent in pieces, stored
# in a temporary file and handed to the save function with take_upload().
# --------------------------------------------------------------------------

def _upload_path(upload_id):
    upload_id = str(upload_id)
    if not upload_id or any(not ("a" <= c <= "z" or "0" <= c <= "9") for c in upload_id):
        raise ValueError("Invalid upload id.")
    return _os.path.join(tempfile.gettempdir(), "displayforge_upload_%s.part" % upload_id)


def upload_chunk(upload_id, index, chunk):
    """Append one piece of a payload; index 0 starts a new upload."""
    path = _upload_path(upload_id)
    with io.open(path, "w" if int(index) == 0 else "a", encoding="utf-8") as handle:
        handle.write(chunk)
    return json.dumps({"ok": True, "index": int(index)})


def take_upload(upload_id):
    """Return the text of a finished upload and delete its temporary file."""
    path = _upload_path(upload_id)
    if not _os.path.isfile(path):
        raise ValueError("The upload %s was not received." % upload_id)
    with io.open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    try:
        _os.remove(path)
    except Exception:
        pass
    return text


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
    objects = _os.path.join(project, "objects")
    for entry in _os.listdir(objects):
        if entry.lower() == wanted.lower() and _os.path.isdir(_os.path.join(objects, entry)):
            return _os.path.join(objects, entry), "objects/%s" % entry
    if not create:
        return None, None
    folder = _os.path.join(objects, wanted)
    _os.makedirs(folder)
    return folder, "objects/%s" % wanted


def _existing_spelling(folder, file_name):
    """Keep the on-disk spelling of a file that already exists (case-insensitive match)."""
    for candidate in _os.listdir(folder):
        if candidate.lower() == file_name.lower():
            return candidate
    return file_name


def _write_file(path, data):
    """Write bytes through a temporary file so Designer never sees a half-written file."""
    temp_path = path + ".partial"
    with open(temp_path, "wb") as handle:
        handle.write(data)
    if _os.path.exists(path):
        _os.remove(path)
    _os.rename(temp_path, path)


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
        for candidate in _os.listdir(folder):
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
    _write_file(_os.path.join(folder, file_name), text.encode("utf-8"))
    relative = "%s/%s" % (prefix, file_name)
    try:
        _load_fresh(relative, d3.MeshFromObj)
    except Exception:
        pass  # create_led_screen retries the load
    return json.dumps({"ok": True, "path": relative})


# --------------------------------------------------------------------------
# OBJ import: list and read the meshes of the project
# --------------------------------------------------------------------------

# Folders DisplayForge reads OBJ files from. objects/meshfromobj is listed only
# so OBJs left there by older versions can still be imported.
IMPORT_FOLDERS = (MESH_FOLDER, "meshfromobj")


def _screens_using(relative_path):
    """LED screens whose mesh is the OBJ at relative_path: [{name, resolution}]."""
    import d3

    wanted = relative_path.replace("\\", "/").lower()
    found = []
    try:
        screens = d3.resourceManager.allResources(d3.LedScreen)
    except Exception:
        screens = list(d3.state.stage.ledScreens)
    for screen in screens:
        try:
            mesh = screen.mesh
            if mesh is None:
                continue
            mesh_path = str(mesh.path).replace("\\", "/").lower()
            if not mesh_path.endswith(wanted):
                continue
            found.append({
                "name": str(screen.description),
                "resolution": [int(screen.resolution.x), int(screen.resolution.y)],
            })
        except Exception:
            continue
    return found


def list_meshes():
    """OBJ files in objects/Mesh (and legacy objects/meshfromobj), with the LED screens that use them."""
    if _project_folder() is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    meshes = []
    for wanted in IMPORT_FOLDERS:
        folder, prefix = _objects_subfolder(wanted, False)
        if folder is None:
            continue
        for entry in sorted(_os.listdir(folder), key=lambda s: s.lower()):
            path = _os.path.join(folder, entry)
            if not entry.lower().endswith(".obj") or not _os.path.isfile(path):
                continue
            relative = "%s/%s" % (prefix, entry)
            meshes.append({
                "path": relative,
                "size": _os.path.getsize(path),
                "screens": _screens_using(relative),
            })
    return json.dumps({"ok": True, "meshes": meshes})


def read_mesh(relative_path):
    """Text of an OBJ listed by list_meshes (only objects/Mesh and objects/meshfromobj)."""
    parts = str(relative_path).replace("\\", "/").split("/")
    if (
        len(parts) != 3
        or parts[0].lower() != "objects"
        or parts[1].lower() not in [f.lower() for f in IMPORT_FOLDERS]
        or not parts[2].lower().endswith(".obj")
        or parts[2] in ("", ".", "..")
    ):
        raise ValueError("Only OBJ files in objects/Mesh can be imported.")
    folder, prefix = _objects_subfolder(parts[1], False)
    if folder is None:
        return json.dumps({"ok": False, "error": "Folder objects/%s not found." % parts[1]})
    path = _os.path.join(folder, parts[2])
    if not _os.path.isfile(path):
        return json.dumps({"ok": False, "error": "%s not found." % relative_path})
    with open(path, "rb") as handle:
        data = handle.read()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    relative = "%s/%s" % (prefix, parts[2])
    return json.dumps({"ok": True, "path": relative, "text": text, "screens": _screens_using(relative)})


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
    _write_file(_os.path.join(folder, png_name), data)
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


def save_test_pattern(file_name, png_base64):
    """Write objects/VideoFile/TestPattern/<file_name>.png (a DisplayForge test
    pattern), creating the TestPattern folder when it does not exist."""
    file_name = _valid_name(file_name)
    data = base64.b64decode(png_base64)
    if data[:8] != PNG_SIGNATURE:
        raise ValueError("The test pattern is not a PNG image.")
    video, video_prefix = _objects_subfolder(VIDEO_FOLDER, True)
    if video is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    folder = prefix = None
    for entry in _os.listdir(video):
        if entry.lower() == TEST_PATTERN_FOLDER.lower() and _os.path.isdir(_os.path.join(video, entry)):
            folder, prefix = _os.path.join(video, entry), "%s/%s" % (video_prefix, entry)
            break
    if folder is None:
        folder, prefix = _os.path.join(video, TEST_PATTERN_FOLDER), "%s/%s" % (video_prefix, TEST_PATTERN_FOLDER)
        _os.makedirs(folder)
    png_name = _existing_spelling(folder, "%s.png" % file_name)
    _write_file(_os.path.join(folder, png_name), data)
    return json.dumps({"ok": True, "path": "%s/%s" % (prefix, png_name)})


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
            candidates.append(_os.path.dirname(_os.path.dirname(_os.path.normpath(directory))))
    except Exception:
        pass
    # 2. The stage resource lives inside the project folder.
    try:
        stage_dir = str(d3.state.stage.path.directory)
        if stage_dir:
            folder = _os.path.normpath(stage_dir)
            while folder and _os.path.basename(folder).lower() != "objects":
                parent = _os.path.dirname(folder)
                if parent == folder:
                    folder = ""
                    break
                folder = parent
            if folder:
                candidates.append(_os.path.dirname(folder))
    except Exception:
        pass
    # 3. Designer normally runs with the project folder as working directory.
    try:
        candidates.append(_os.getcwd())
    except Exception:
        pass
    return candidates


def _project_folder():
    for folder in _candidate_project_folders():
        if folder and _os.path.isabs(folder) and _os.path.isdir(_os.path.join(folder, "objects")):
            return folder
    return None


def _plugin_folder(project):
    """Folder of this plugin when it is installed in <project>/plugins, else None.

    The module is registered from text, so it cannot use __file__: look for a
    plugin folder whose d3plugin.json is named DisplayForge.
    """
    plugins = None
    for entry in _os.listdir(project):
        if entry.lower() == "plugins" and _os.path.isdir(_os.path.join(project, entry)):
            plugins = _os.path.join(project, entry)
            break
    if plugins is None:
        return None
    for entry in sorted(_os.listdir(plugins)):
        manifest = _os.path.join(plugins, entry, PLUGIN_MANIFEST)
        if not _os.path.isfile(manifest):
            continue
        try:
            with open(manifest, "r") as handle:
                name = json.loads(handle.read()).get("name")
        except Exception:
            continue
        if str(name).strip().lower() == PLUGIN_NAME.lower():
            return _os.path.join(plugins, entry)
    return None


def _legacy_state_path(folder):
    return _os.path.join(folder, LEGACY_STATE_FOLDER, STATE_FILE)


def _state_path():
    folder = _project_folder()
    if folder is None:
        return None, None
    plugin = _plugin_folder(folder)
    if plugin is not None:
        return folder, _os.path.join(plugin, STATE_FILE)
    return folder, _legacy_state_path(folder)


def _remove_legacy_state(folder, path):
    """After a save next to the plugin, drop the old <project>/displayforge copy."""
    legacy = _legacy_state_path(folder)
    if _os.path.normcase(_os.path.abspath(legacy)) == _os.path.normcase(_os.path.abspath(path)):
        return
    try:
        if _os.path.isfile(legacy):
            _os.remove(legacy)
        directory = _os.path.dirname(legacy)
        if _os.path.isdir(directory) and not _os.listdir(directory):
            _os.rmdir(directory)
    except Exception:
        pass


def project_info():
    folder, path = _state_path()
    return json.dumps({"ok": folder is not None, "projectFolder": folder, "stateFile": path})


def load_state():
    folder, path = _state_path()
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    migrate = False
    if not _os.path.isfile(path):
        legacy = _legacy_state_path(folder)
        if not _os.path.isfile(legacy):
            return json.dumps({"ok": True, "projectFolder": folder, "data": None})
        path = legacy  # saved by 0.8.1 or earlier: the plugin saves it again next to itself
        migrate = True
    with open(path, "r") as handle:
        text = handle.read()
    try:
        data = json.loads(text)
    except ValueError as error:
        return json.dumps({"ok": False, "projectFolder": folder, "error": "Invalid %s: %s" % (path, error)})
    return json.dumps({"ok": True, "projectFolder": folder, "data": data, "migrate": migrate})


def save_state(text):
    folder, path = _state_path()
    if folder is None:
        return json.dumps({"ok": False, "error": "Could not locate the Designer project folder."})
    json.loads(text)  # refuse to write invalid JSON
    directory = _os.path.dirname(path)
    if not _os.path.isdir(directory):
        _os.makedirs(directory)
    temp_path = path + ".tmp"
    with open(temp_path, "w") as handle:
        handle.write(text)
    if _os.path.exists(path):
        _os.remove(path)
    _os.rename(temp_path, path)
    _remove_legacy_state(folder, path)
    return json.dumps({"ok": True, "projectFolder": folder, "stateFile": path})
