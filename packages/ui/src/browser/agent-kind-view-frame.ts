// The whole script of the frame a kind's chat view runs in (../agent-kind-view/frame.ts says what
// the frame is). scripts/build-agent-kind-view-frame.ts bundles this file as one classic script.
import { startAgentKindViewFrame } from "../agent-kind-view/frame.ts";

startAgentKindViewFrame(document.getElementById("root")!);
