/* ============================================================
   Drawer + toast — standalone (views use these)
   ============================================================ */

export function openDrawer(kicker, title, bodyNode) {
  const d = document.getElementById("drawer");
  const s = document.getElementById("scrim");
  const k = document.getElementById("drawer-kicker");
  const t = document.getElementById("drawer-title");
  const body = document.getElementById("drawer-body");
  if (k) k.textContent = kicker || "";
  if (t) t.textContent = title || "";
  if (body) {
    body.innerHTML = "";
    body.append(bodyNode);
    body.scrollTop = 0;
  }
  if (d) d.hidden = false;
  if (s) s.hidden = false;
}

export function closeDrawer() {
  const d = document.getElementById("drawer");
  const s = document.getElementById("scrim");
  if (d) d.hidden = true;
  if (s) s.hidden = true;
}

let toastTimer;

export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    Object.assign(t.style, {
      position: "fixed", bottom: "22px", left: "50%",
      transform: "translateX(-50%) translateY(20px)",
      background: "rgba(22,31,51,.97)", border: "1px solid rgba(125,211,252,.45)", color: "#dff2ff",
      padding: "10px 20px", borderRadius: "999px", fontSize: "13.5px", zIndex: "200",
      boxShadow: "0 10px 40px rgba(0,0,0,.5)", opacity: "0",
      transition: "all .28s cubic-bezier(.2,.9,.3,1)", pointerEvents: "none",
      maxWidth: "80vw", textAlign: "center",
    });
    document.body.append(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateX(-50%) translateY(0)"; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(-50%) translateY(20px)"; }, 2600);
}
