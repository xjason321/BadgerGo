import { useEffect } from "react";
import { CloseIcon } from "./icons";

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Credits, data sources and licences for everything BadgerGo is built on. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="about-wrap" onClick={onClose}>
      <div className="about" role="dialog" aria-modal="true" aria-label="About BadgerGo" onClick={(e) => e.stopPropagation()}>
        <button className="about-x" onClick={onClose} aria-label="Close"><CloseIcon size={18} /></button>
        <div className="about-head">
          <img src="/badgergo-logo.png" alt="" width={44} height={44} />
          <div>
            <h2>BadgerGo!</h2>
            <span>Bike-share trip planning for Madison</span>
          </div>
        </div>
        <div className="about-body">
          <h3>Data &amp; services</h3>
          <ul>
            <li><b>Bike and dock availability</b> comes from the public <a href="https://www.bcycle.com/gbfs" {...ext}>BCycle GBFS feed</a> for <a href="https://madison.bcycle.com/" {...ext}>Madison BCycle</a>. BCycle and the BCycle logo belong to BCycle, LLC.</li>
            <li><b>Map and place data</b> © <a href="https://www.openstreetmap.org/copyright" {...ext}>OpenStreetMap contributors</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/" {...ext}>Open Database Licence</a>. Bike lanes, paths, trails and the city limits come from it.</li>
            <li><b>Routing and elevation</b> are computed by <a href="https://valhalla.github.io/valhalla/" {...ext}>Valhalla</a>, open-source routing software, on OpenStreetMap data.</li>
            <li><b>Place search</b> uses <a href="https://nominatim.org/" {...ext}>Nominatim</a>, run by the OpenStreetMap Foundation.</li>
            <li><b>Map display</b> uses <a href="https://leafletjs.com/" {...ext}>Leaflet</a>. Text is set in <a href="https://rsms.me/inter/" {...ext}>Inter</a>.</li>
            <li><b>Turn-by-turn navigation</b> is handed off to Google Maps or Apple Maps, which are trademarks of their owners. The way a long ride is split into links that stay on your route follows the approach of <a href="https://github.com/Awonder9/BadgerBikes" {...ext}>BadgerBikes</a> by Awonder9.</li>
          </ul>
          <h3>Good to know</h3>
          <ul>
            <li>BadgerGo is an independent project. It is not made by, affiliated with or endorsed by BCycle, Madison BCycle or the City of Madison.</li>
            <li>Bike and dock counts change constantly and can be a minute or more out of date. Ride times are estimates, and ride-time pricing is shown for the BCycle student plan (30 free minutes, then $8 for each extra 30).</li>
            <li>Routes are suggestions. Obey traffic laws and posted signs, and use your own judgement about road and trail conditions.</li>
            <li>Your location is used to plan trips and follow your ride. BadgerGo doesn't keep it, but the start and end points of a trip are sent to the routing and search services above to work out routes.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
