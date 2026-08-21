import { useEffect, useRef, useState } from "react";
import { TempleStrings } from "../lib/scene.js";
import { ChimeEngine } from "../lib/chime.js";

export default function StringInstrument() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const chimeRef = useRef(null);

  const [armed, setArmed] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const scene = new TempleStrings(containerRef.current);
    sceneRef.current = scene;

    // StrictMode mounts effects twice in development, so teardown has to be
    // complete — otherwise the second mount stacks a second render loop.
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
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
    setArmed(true);

    // Dev-only handle for poking at the sim from the console. Vite strips this
    // branch from production builds.
    if (import.meta.env.DEV) {
      window.__temple = { scene: sceneRef.current, chime };
    }
  }

  return (
    <div className="stage">
      <div
        className="canvas-host"
        ref={containerRef}
        onPointerMove={() => armed && !touched && setTouched(true)}
      />

      <header className="masthead" aria-hidden="true">
        <h1>Temple</h1>
        <p className="sub">nineteen strings</p>
      </header>

      {!armed && (
        <button className="gate" onClick={arm} type="button">
          <span className="gate-ring" />
          <span className="gate-label">Touch to wake the strings</span>
          <span className="gate-note">sound on</span>
        </button>
      )}

      {armed && !touched && (
        <p className="hint">Move across the strings</p>
      )}
    </div>
  );
}
