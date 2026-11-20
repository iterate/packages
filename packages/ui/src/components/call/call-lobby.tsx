// call-lobby.tsx — THE LOBBY BEFORE A CALL: what a page shows between a Join (or a link that asks
// to join) and the call itself. The person sees their camera's picture and their microphone's
// level, chooses the camera, the microphone and the speaker (and plays a test sound on it), sees
// who is in the call now, and then joins with what is on, or joins muted.
//
// - NOTHING LEAVES THE BROWSER IN THE LOBBY: it opens the devices here only, for the preview. No
//   SFU session, no call method: who is in the call comes from the live state the page has.
// - CAPTURE STARTS ONLY BY A PRESS: the camera is off until its button is pressed. The microphone
//   opens at once only when a press opened the lobby (`micAtStart`: the person's Join or Start); a
//   lobby a link opened (`call=join`) opens nothing by itself.
// - JOIN HANDS OVER WHAT IS OPEN: `onJoin` gets the microphone (its track's `enabled` is the mute)
//   and the camera, which the engine's `join({ mic, camera })` takes as they are: the browser is
//   not asked twice. A lobby that closes without a join stops them.
// - A REFUSAL IS SAID IN WORDS, and Join stays: with no microphone the page joins and listens.
// - LATER: a person who may admit others sees who waits for that here (`waiting`, a slot, not
//   built yet: "this guest is waiting, let them in").
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MicIcon, MicOffIcon, Volume2Icon, VideoIcon, VideoOffIcon } from "lucide-react";
import { cn } from "cn";
import { captureDevice, saveDevice, savedDevices } from "#/lib/call-engine.ts";
import { deviceOptions, pickDevice, type CallLive, type DeviceKind } from "#/lib/call-rules.ts";
import { Alert, AlertDescription } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";

/** What a join takes from the lobby. */
export type LobbyMedia = { mic: MediaStream | null; camera: MediaStream | null };

/**
 * `live`: the call's live state, for who is in it (undefined while unread, or with no call yet).
 * `action`: "join" for a call that is on, "start" for an agent with none. `micAtStart`: a press of
 * the person's opened the lobby, so the microphone opens at once. `onJoin`: the person pressed Join
 * now (or Join muted); the call owns the streams from then. `waiting`: the place for those who wait
 * to be let in, later.
 */
export function CallLobby({
  live,
  action,
  micAtStart = false,
  onJoin,
  waiting,
  className,
}: {
  live: CallLive | undefined;
  action: "join" | "start";
  micAtStart?: boolean;
  onJoin: (media: LobbyMedia) => void;
  waiting?: ReactNode;
  className?: string;
}) {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(savedDevices);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState<Partial<Record<"mic" | "camera", boolean>>>({});
  const [refused, setRefused] = useState<Partial<Record<"mic" | "camera", string>>>({});
  // what this lobby holds now, for its end: handed to the call, or stopped
  const held = useRef<LobbyMedia>({ mic: null, camera: null });
  // each kind's newest open: an Off or a newer open makes an older one's stream stop on arrival
  const asked = useRef({ mic: 0, camera: 0 });
  const sinkOk = "HTMLMediaElement" in globalThis && "setSinkId" in HTMLMediaElement.prototype;

  const listDevices = async () => {
    const found = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => null)) ?? [];
    setList(found);
    return found;
  };
  const keep = (kind: "mic" | "camera", stream: MediaStream | null) => {
    held.current = { ...held.current, [kind]: stream };
    (kind === "mic" ? setMic : setCamera)(stream);
  };
  const close = (kind: "mic" | "camera") => {
    asked.current[kind] += 1;
    stopAll(held.current[kind]);
    keep(kind, null);
    setOpening((now) => ({ ...now, [kind]: false }));
  };
  const open = async (kind: "mic" | "camera", known = list) => {
    const mine = ++asked.current[kind];
    setOpening((now) => ({ ...now, [kind]: true }));
    setRefused((now) => ({ ...now, [kind]: undefined }));
    try {
      const stream = await captureDevice(kind, pickDevice(known, kind, savedDevices()[kind]));
      if (asked.current[kind] !== mine) return stopAll(stream);
      stopAll(held.current[kind]);
      keep(kind, stream);
      // the names of the devices come with the first permission
      void listDevices();
    } catch (error) {
      if (asked.current[kind] === mine)
        setRefused((now) => ({ ...now, [kind]: refusal(kind, error) }));
    } finally {
      if (asked.current[kind] === mine) setOpening((now) => ({ ...now, [kind]: false }));
    }
  };
  const choose = (kind: DeviceKind, id: string) => {
    const label = list.find((device) => device.deviceId === id)?.label ?? "";
    setSaved(saveDevice(kind, id, label));
    // a device in use now changes now
    if (kind !== "speaker" && held.current[kind]) void open(kind);
  };
  const join = (muted: boolean) => {
    const media = held.current;
    const track = media.mic?.getAudioTracks()[0];
    if (track) track.enabled = !muted;
    // the call owns them from here: this lobby's end stops nothing
    held.current = { mic: null, camera: null };
    asked.current.mic += 1;
    asked.current.camera += 1;
    onJoin(media);
  };

  // at the start: the devices, and the microphone when a press opened the lobby; at the end
  // without a join, what is open stops (a join cleared `held` first)
  const opensMic = useRef(micAtStart);
  const begin = useRef(open);
  useEffect(() => {
    begin.current = open;
  });
  useEffect(() => {
    let mounted = true;
    const changed = () => void listDevices();
    void listDevices().then((found) => {
      if (mounted && opensMic.current) void begin.current("mic", found);
    });
    navigator.mediaDevices?.addEventListener?.("devicechange", changed);
    const opens = asked.current;
    return () => {
      mounted = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", changed);
      opens.mic += 1;
      opens.camera += 1;
      stopAll(held.current.mic);
      stopAll(held.current.camera);
      held.current = { mic: null, camera: null };
    };
  }, []);

  const chosen = (kind: DeviceKind) => pickDevice(list, kind, saved[kind]);
  const start = action === "start";
  return (
    <div data-slot="call-lobby" className={cn("flex flex-col gap-4", className)}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {camera ? (
          <Preview stream={camera} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <VideoOffIcon aria-hidden />
            {opening.camera ? "Opening the camera…" : "Your camera is off"}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-3">
          <Switch
            on={Boolean(mic)}
            busy={Boolean(opening.mic)}
            label="Microphone"
            title={mic ? "Turn the microphone off" : "Turn the microphone on"}
            icon={mic ? <MicIcon /> : <MicOffIcon />}
            onPress={() => (mic || opening.mic ? close("mic") : void open("mic"))}
          />
          <Switch
            on={Boolean(camera)}
            busy={Boolean(opening.camera)}
            label="Camera"
            title={camera ? "Turn the camera off" : "Turn the camera on"}
            icon={camera ? <VideoIcon /> : <VideoOffIcon />}
            onPress={() => (camera || opening.camera ? close("camera") : void open("camera"))}
          />
        </div>
      </div>
      {mic ? <Level stream={mic} /> : null}
      {refused.mic || refused.camera ? (
        <Alert role="alert">
          <AlertDescription className="flex flex-col gap-1">
            {refused.mic ? <span>{refused.mic}</span> : null}
            {refused.camera ? <span>{refused.camera}</span> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {(["mic", "camera", "speaker"] as const).map((kind) =>
          kind === "speaker" && !sinkOk ? (
            <p key={kind} className="self-end font-readme text-xs text-muted-foreground">
              This browser plays through its default speaker.
            </p>
          ) : (
            <label key={kind} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              {PICKED[kind]}
              <NativeSelect
                className="w-full"
                value={chosen(kind)}
                onChange={(event) => choose(kind, event.target.value)}
              >
                {deviceOptions(list, kind).map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ),
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => playTestSound(sinkOk ? chosen("speaker") : "")}
      >
        <Volume2Icon data-icon="inline-start" />
        Play a test sound
      </Button>
      <p data-slot="call-lobby-who" className="font-readme text-sm text-muted-foreground">
        {whoIsIn(live, start)}
      </p>
      {waiting ? <div data-slot="call-lobby-waiting">{waiting}</div> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {mic ? (
          <Button variant="outline" onClick={() => join(true)}>
            {start ? "Start muted" : "Join muted"}
          </Button>
        ) : null}
        <Button onClick={() => join(false)}>{start ? "Start the call" : "Join now"}</Button>
      </div>
    </div>
  );
}

const PICKED: Record<DeviceKind, string> = {
  mic: "Microphone",
  camera: "Camera",
  speaker: "Speaker",
};

const stopAll = (stream: MediaStream | null | undefined) => {
  for (const track of stream?.getTracks() || []) track.stop();
};

/** Why a device did not open, in words; Join stays possible. */
function refusal(kind: "mic" | "camera", error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (kind === "mic")
    return name === "NotAllowedError"
      ? "The browser did not give this page the microphone. Allow it for this site to talk; you can still join and listen."
      : `No microphone could be opened (${message}). You can still join and listen.`;
  return name === "NotAllowedError"
    ? "The browser did not give this page the camera. Allow it for this site to be seen; you can still join without it."
    : `No camera could be opened (${message}). You can still join without it.`;
}

/** Who is in the call now, in one sentence, from its live state. */
export function whoIsIn(live: CallLive | undefined, start: boolean) {
  if (start) return "Nobody is in the call yet: you start it.";
  if (!live) return "Looking for who is in the call…";
  const names = [
    ...new Map(
      Object.values(live.inCall).map(({ who }) => [
        who.actor,
        who.kind ? `${who.name} (guest)` : who.name,
      ]),
    ).values(),
    ...(live.voiceAgent ? ["the voice agent"] : []),
  ];
  if (!names.length) return "Nobody is in the call yet.";
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `In the call now: ${listed}.`;
}

/** The lobby's switches: an icon, a fixed name, and whether it is on (`aria-pressed`). */
function Switch({
  on,
  busy,
  label,
  title,
  icon,
  onPress,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  title: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Button
      size="icon-lg"
      variant={on ? "secondary" : "destructive"}
      className="rounded-full"
      aria-label={label}
      aria-pressed={on}
      aria-busy={busy || undefined}
      title={busy ? "Opening…" : title}
      onClick={onPress}
    >
      {icon}
    </Button>
  );
}

/** The camera's picture, as the person sees themselves: mirrored. */
function Preview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label="Your camera's picture"
      className="size-full -scale-x-100 object-cover"
    />
  );
}

/** The microphone's level, drawn straight to the bar at each frame (no render per frame). A
 *  browser with no Web Audio shows none. */
function Level({ stream }: { stream: MediaStream }) {
  const bar = useRef<HTMLDivElement>(null);
  const supported = "AudioContext" in globalThis;
  useEffect(() => {
    if (!supported) return;
    const context = new AudioContext();
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    try {
      // made without a press, it starts suspended: a press opened the lobby or the microphone
      void context.resume?.().catch(() => {});
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      // a Web Audio that cannot measure this stream: no level, and the lobby goes on
      void context.close?.().catch(() => {});
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      // speech sits around 0.02 to 0.2 RMS: the bar is full at 0.25
      const level = Math.min(1, Math.sqrt(sum / samples.length) / 0.25);
      if (bar.current) bar.current.style.transform = `scaleX(${level})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => {});
    };
  }, [stream, supported]);
  if (!supported) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <MicIcon aria-hidden className="size-4" />
      <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          ref={bar}
          // the frame loop sets `transform`; Tailwind's scale classes set `scale`, which would multiply
          style={{ transform: "scaleX(0)" }}
          className="h-full origin-left rounded-full bg-success transition-transform duration-75"
        />
      </div>
      <span>Speak to see your level</span>
    </div>
  );
}

/** A short tone through the chosen speaker ("" is the default). */
function playTestSound(sink: string) {
  const rate = 24_000;
  const seconds = 0.6;
  const count = Math.floor(rate * seconds);
  const data = new DataView(new ArrayBuffer(44 + count * 2));
  const text = (at: number, words: string) => {
    for (let i = 0; i < words.length; i++) data.setUint8(at + i, words.charCodeAt(i));
  };
  // a WAV file: 16-bit mono PCM
  text(0, "RIFF");
  data.setUint32(4, 36 + count * 2, true);
  text(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    // two notes, each faded in and out so that it does not click
    const note = t < seconds / 2 ? 660 : 880;
    const local = t % (seconds / 2);
    const fade = Math.min(1, local / 0.02, (seconds / 2 - local) / 0.05);
    data.setInt16(44 + i * 2, Math.sin(2 * Math.PI * note * t) * fade * 0.3 * 32_767, true);
  }
  const url = URL.createObjectURL(new Blob([data.buffer], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  const play = () => audio.play().catch(() => URL.revokeObjectURL(url));
  if (sink && "setSinkId" in audio) void audio.setSinkId(sink).then(play, play);
  else void play();
}
