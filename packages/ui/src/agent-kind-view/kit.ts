// What a kind's `view(kit)` builds with (types.ts `AgentKindViewKit`): htm over React, the derived and
// server-state hooks, and iterate's chat parts. No useState or useEffect: a view derives what it
// shows from its props.
import htm from "htm";
import { createElement, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AgentChat } from "../components/agent-chat/agent-chat.tsx";
import { AgentShell } from "../components/agent-chat/agent-shell.tsx";
import { Composer, Feed, Markdown, MessageBubble } from "../components/agent-chat/chat-parts.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import type { AgentKindViewKit } from "./types.ts";

export const agentKindViewKit: AgentKindViewKit = {
  html: htm.bind(createElement),
  useMemo,
  useQuery,
  useMutation,
  ui: { AgentShell, AgentChat, Feed, MessageBubble, Composer, Markdown, Badge, Button, Spinner },
};
