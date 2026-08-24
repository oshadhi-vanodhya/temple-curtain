import { useEffect, useRef, useState } from "react";
import { TempleStrings } from "../lib/scene.js";
import { ChimeEngine } from "../lib/chime.js";
import { Water } from "../lib/water.js";

export default function StringInstrument() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const chimeRef = useRef(null);
  const waterRef = useRef(null);

  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const scene = new TempleStrings(containerRef.current);
    sceneRef.current = scene;

    // Dev-only handle for poking at the cloth from the console. Attached here
    // rather than after arming, so inspecting the simulation never depends on
    // audio being switched on. Vite strips this branch from production builds.
    if (import.meta.env.DEV) {
      window.__temple = { ...window.__temple, scene };
    }

    // StrictMode mounts effects twice in development, so teardown has to be
    // complete — otherwise the second mount stacks a second render loop.
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      waterRef.current?.dispose();
      waterRef.current = null;
      chimeRef.current?.dispose();
      chimeRef.current = null;
    };
  }, []);

  // Every browser starts an AudioContext suspended; only a trusted gesture can
  // resume it, which is why the sound lives behind this one deliberate click.
  async function arm() {
    if (armed) return;

    const chime = chimeRef.current ?? new ChimeEngine();
    chimeRef.current = chime;

    const ok = await chime.start();
    if (!ok) return;

    sceneRef.current?.attachAudio(chime);

    // The waterfall is always running; it just fades up rather than cutting in.
    if (!waterRef.current) {
      waterRef.current = new Water(chime.ctx, chime.ambientBus);
      waterRef.current.fadeTo(0.085, 8);
    }

    setArmed(true);

    if (import.meta.env.DEV) {
      window.__temple = { ...window.__temple, scene: sceneRef.current, chime };
    }
  }

  return (
    <div className="stage">
      <div className="canvas-host" ref={containerRef} />

      {!armed && (
        <button className="gate" onClick={arm} type="button">
          <span className="gate-ring" />
          <span className="gate-label">Touch to wake the strings</span>
          <span className="gate-note">sound on</span>
        </button>
      )}
    </div>
  );
}
