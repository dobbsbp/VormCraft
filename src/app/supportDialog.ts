import { LINKS, openLink } from './help';

// The QRIS code (Indonesia's national payment QR), if one is in src/app/assets. Bundled with the
// app so it also shows offline; without the file the window just offers GitHub Sponsors.
const qris = Object.values(import.meta.glob<string>('./assets/qris.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }))[0];

/** Support VormCraft (toolbar ♥, Help menu): GitHub Sponsors, and QRIS for people in Indonesia. */
export function showSupport(): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal support';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Support VormCraft</h2>
      <p>VormCraft is free and always will be. If it is useful to you, a small donation helps pay for the website and upkeep. Thank you!</p>
      <p><button type="button" class="primary sponsor">♥ Sponsor on GitHub</button></p>
      <div class="qris" hidden>
        <img alt="QRIS payment code for VormCraft" />
        <p class="note">In Indonesia: scan with any bank or e-wallet app (QRIS).</p>
      </div>
      <div class="buttons"><button type="submit">Close</button></div>
    </form>`;
  dlg.querySelector('.sponsor')!.addEventListener('click', () => void openLink(LINKS.support));
  if (qris) {
    dlg.querySelector<HTMLElement>('.qris')!.hidden = false;
    dlg.querySelector('img')!.src = qris;
  }
  document.body.append(dlg);
  const finish = () => {
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('cancel', finish);
  dlg.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    finish();
  });
  dlg.showModal();
}
