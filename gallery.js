(() => {
  function setupGallery() {
    const photo = document.getElementById('photo');
    if (!photo || document.getElementById('galleryBtn')) return;

    const gallery = document.createElement('input');
    gallery.type = 'file';
    gallery.accept = 'image/*';
    gallery.id = 'galleryPhoto';
    gallery.style.display = 'none';
    photo.insertAdjacentElement('afterend', gallery);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'galleryBtn';
    btn.className = 'secondary';
    btn.textContent = '🖼️ Izberi sliko iz galerije';

    const card = photo.closest('.card');
    const row = card ? card.querySelector('.btnrow') : null;
    if (row) row.appendChild(btn);
    else photo.insertAdjacentElement('afterend', btn);

    btn.addEventListener('click', () => {
      gallery.value = '';
      gallery.click();
    });

    gallery.addEventListener('change', async () => {
      const file = gallery.files && gallery.files[0];
      if (!file) return;

      const status = document.getElementById('ocrStatus');
      if (typeof window.readBarcodeFromGallery === 'function') {
        await window.readBarcodeFromGallery(file);
        return;
      }

      // Rezervni način za starejšo različico aplikacije.
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        photo.files = dt.files;
        photo.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        console.error(err);
        if (status) status.textContent = 'Izbira iz galerije v tem brskalniku ni uspela. Poskusi odpreti aplikacijo v Safari/Chrome.';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGallery, { once: true });
  } else {
    setupGallery();
  }
})();
