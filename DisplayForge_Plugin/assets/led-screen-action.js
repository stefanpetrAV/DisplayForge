const moduleName = "displayforge_led_screen";
let registration;

function getDirectorEndpoint() {
  const params = new URLSearchParams(window.location.search);
  const director = params.get("director");
  if (director) {
    return director.includes(":")
      ? director
      : `${director}:${params.get("port") || "80"}`;
  }
  const host = window.location.host || "localhost";
  return host.includes(":") ? host : `${host}:80`;
}

function getApiBase() {
  return `http://${getDirectorEndpoint()}/api/session/python`;
}

async function postPythonApi(path, body) {
  const response = await fetch(`${getApiBase()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Designer Python API: HTTP ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.status && result.status.code !== 0) {
    throw new Error(result.status.message || "Designer rejected the Python request.");
  }
  return result;
}

function ensureRegistered() {
  if (!registration) {
    registration = fetch("./assets/led-screen.py")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load the Designer module (HTTP ${response.status}).`);
        }
        return response.text();
      })
      .then((contents) => postPythonApi("registermodule", { moduleName, contents }))
      .catch((error) => {
        registration = undefined;
        throw error;
      });
  }
  return registration;
}

function cleanReturnValue(raw) {
  if (raw === null || raw === undefined || raw === "None") return null;

  let value = raw;
  if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      // Keep the original value and let the JSON parse below report a useful error.
    }
  }
  return typeof value === "string" ? JSON.parse(value) : value;
}

function getScreenInput() {
  const nameLabel = [...document.querySelectorAll("label")].find((label) =>
    label.textContent.trim().startsWith("File name"),
  );
  const name = nameLabel?.querySelector("input")?.value?.trim();
  const resolutionText = document.querySelector(".stats span:nth-child(2)")?.textContent || "";
  const resolution = resolutionText.match(/([\d,]+)\s*[x×]\s*([\d,]+)\s*px/i);

  if (!name) throw new Error("Enter a file name before creating the LED screen.");
  if (!resolution) throw new Error("Generate a valid mesh before creating the LED screen.");

  const meshName = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "") || "screen";

  return {
    name: meshName,
    width: Number(resolution[1].replace(/,/g, "")),
    height: Number(resolution[2].replace(/,/g, "")),
  };
}

function showStatus(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#ff7777" : "#77dd99";
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function createScreen(status, button) {
  button.disabled = true;
  showStatus(status, "Exporting OBJ and waiting for Designer to load the mesh...");

  try {
    const { name, width, height } = getScreenInput();
    const downloadButton = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent.trim() === "Download .obj",
    );
    if (!downloadButton) {
      throw new Error("The OBJ export button is unavailable.");
    }

    downloadButton.click();
    const exportError = downloadButton.parentElement.querySelector(".error");
    if (exportError?.textContent.trim()) {
      throw new Error(exportError.textContent.trim());
    }

    await delay(1000);
    await ensureRegistered();
    const deadline = Date.now() + 30000;
    const retryDelays = [250, 500, 1000, 1500, 2000];
    let attempt = 0;
    let lastError = "Designer did not detect a valid exported mesh.";

    while (Date.now() < deadline) {
      attempt += 1;
      showStatus(status, `Waiting for Designer to load the OBJ (attempt ${attempt})...`);

      const result = await postPythonApi("execute", {
        moduleName,
        script: `return create_led_screen(${JSON.stringify(name)}, ${width}, ${height})`,
      });
      const data = cleanReturnValue(result.returnValue);
      if (data?.ok === true) {
        showStatus(status, `${data.name} created · ${data.resolution[0]} × ${data.resolution[1]} px`);
        return;
      }
      if (!data?.pending) {
        throw new Error(data?.error || "Designer did not confirm LED screen creation.");
      }

      lastError = data.error || lastError;
      const retryDelay = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
      await delay(Math.min(retryDelay, Math.max(0, deadline - Date.now())));
    }

    throw new Error(`Timed out waiting for the OBJ after 30 seconds. Last error: ${lastError}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus(status, message, true);
    console.error("DisplayForge LED screen creation failed:", error);
  } finally {
    button.disabled = false;
  }
}

function addScreenAction() {
  const downloadButton = [...document.querySelectorAll("button")].find((button) =>
    button.textContent.trim() === "Download .obj",
  );
  if (!downloadButton || downloadButton.parentElement.querySelector("[data-displayforge-create-screen]")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = downloadButton.className;
  button.textContent = "Create LED Screen";
  button.dataset.displayforgeCreateScreen = "true";

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.style.margin = "8px 0 0";
  status.style.fontSize = "12px";
  status.style.whiteSpace = "normal";

  button.addEventListener("click", () => createScreen(status, button));
  downloadButton.parentElement.insertBefore(button, downloadButton.nextSibling);
  downloadButton.parentElement.appendChild(status);
}

const app = document.getElementById("app");
if (app) {
  new MutationObserver(addScreenAction).observe(app, { childList: true, subtree: true });
  addScreenAction();
}
