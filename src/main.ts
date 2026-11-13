import { mountStartScreen } from "./ui/StartScreen";

// M0 entry: shows the title screen with the required fan notice and build status.
// The engine boot (renderer, loop, input) is wired in here from M1 onward.
const root = document.getElementById("app");
if (!root) throw new Error("DRIFTGLASS: #app root element missing from index.html");
mountStartScreen(root);
