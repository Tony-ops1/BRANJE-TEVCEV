(() => {
  function setupAutoRead() {
    const photo = document.getElementById("photo");
    const readBtn = document.getElementById("readBtn");
    const status = document.getElementById("ocrStatus");
    if (!photo || !readBtn || photo.dataset.autoRead === "1") return;

    photo.dataset.autoRead = "1";
    readBtn.textContent = "🔄 Ponovi branje";
    if (status) status.textContent = "Po slikanju se podatki preberejo samodejno.";

    photo.addEventListener("change", () => {
      const file = photo.files && photo.files[0];
      if (!file) return;

      ["mkn", "tip", "year", "maker"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const box = document.getElementById("ocrBox");
      if (box) box.textContent = "—";
      if (status) status.textContent = "Fotografija zajeta. Samodejno berem podatke…";

      let attempts = 0;
      const trigger = () => {
        attempts += 1;
        if (!readBtn.disabled) {
          readBtn.click();
          return;
        }
        if (attempts < 30) setTimeout(trigger, 200);
      };
      setTimeout(trigger, 120);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupAutoRead, { once: true });
  } else {
    setupAutoRead();
  }
})();
