import React from "react";

const COLORS = ["#4169E1", "#0EA5E9", "#16A34A", "#F59E0B", "#DB2777", "#7C3AED", "#EA580C", "#0D9488"];

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Shows the uploaded picture when there is one, otherwise a default avatar (initials, or a person icon).
export function Avatar({ name, src, size = 36 }) {
  const [broken, setBroken] = React.useState(false);
  const text = initials(name);
  const color = COLORS[(String(name || "").length + (text.charCodeAt(0) || 0)) % COLORS.length];
  const box = { width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden", display: "inline-grid", placeItems: "center", background: color, color: "#fff", fontWeight: 700, fontSize: Math.round(size * 0.38), verticalAlign: "middle" };
  if (src && !broken) return <span style={box}><img src={src} alt="" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span>;
  if (text) return <span style={box} aria-hidden="true">{text}</span>;
  return <span style={box} aria-hidden="true"><svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg></span>;
}

// Avatar for a locally chosen image file; releases the temporary preview URL when it changes.
export function FileAvatar({ name, file, size = 48 }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (!file) { setUrl(""); return undefined; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return <Avatar name={name} src={url || undefined} size={size} />;
}
