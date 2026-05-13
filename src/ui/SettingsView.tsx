export function SettingsView() {
  return (
    <section className="settings-view">
      <p className="eyebrow">Prototype settings</p>
      <h2>Local Defaults</h2>
      <div className="settings-grid">
        <div>
          <strong>Rounds</strong>
          <span>Best of 3</span>
        </div>
        <div>
          <strong>Timer</strong>
          <span>60 seconds</span>
        </div>
        <div>
          <strong>Saves</strong>
          <span>IndexedDB only</span>
        </div>
        <div>
          <strong>Segmentation</strong>
          <span>MediaPipe, in-browser</span>
        </div>
      </div>
    </section>
  );
}
