import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Crosshair, Loader2, MapPin, TriangleAlert } from "lucide-react";
import { hasGoogleMapsKey, loadGoogleMaps } from "@/lib/google-maps";

export type PickedLocation = {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
};

type Props = {
  value: PickedLocation;
  radiusMeters: number;
  onChange: (next: PickedLocation) => void;
  disabled?: boolean;
};

const DEFAULT_CENTER = { lat: 6.524379, lng: 3.379206 }; // Lagos

/**
 * Sets the branch coordinates the clock-in geofence is measured from.
 *
 * Three ways in, deliberately: search, drag the pin, or capture the device's own
 * GPS. The last one matters more than it looks — an address centroid can sit tens
 * of metres from the actual door, which is the difference between a staff member
 * being inside a 50 m fence and being locked out of their own salon.
 */
export function LocationPicker({ value, radiusMeters, onChange, disabled }: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const searchNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);

  const [mapsState, setMapsState] = useState<"loading" | "ready" | "unavailable">(
    hasGoogleMapsKey() ? "loading" : "unavailable",
  );
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Latest onChange without re-running the map setup on every parent render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Map bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps().then((maps) => {
      if (cancelled) return;
      if (!maps || !mapNodeRef.current) {
        setMapsState("unavailable");
        return;
      }

      const center =
        value.latitude !== null && value.longitude !== null
          ? { lat: value.latitude, lng: value.longitude }
          : DEFAULT_CENTER;

      const map = new maps.Map(mapNodeRef.current, {
        center,
        zoom: value.latitude !== null ? 18 : 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;

      const marker = new maps.Marker({
        map,
        position: center,
        draggable: !disabled,
      });
      markerRef.current = marker;

      const circle = new maps.Circle({
        map,
        center,
        radius: radiusMeters,
        strokeColor: "#059669",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#10b981",
        fillOpacity: 0.15,
      });
      circleRef.current = circle;

      const commit = (lat: number, lng: number, label?: string | null) => {
        marker.setPosition({ lat, lng });
        circle.setCenter({ lat, lng });
        onChangeRef.current({
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
          label: label ?? null,
        });
      };

      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) commit(pos.lat(), pos.lng());
      });

      map.addListener("click", (e: any) => {
        if (disabled || !e.latLng) return;
        commit(e.latLng.lat(), e.latLng.lng());
      });

      // Search is best-effort. The Places web component has churned through
      // several event names, so the map/marker path above stays the reliable one
      // and anything unexpected here is swallowed rather than breaking the picker.
      try {
        const PlaceAutocomplete = (maps as any).places?.PlaceAutocompleteElement;
        if (PlaceAutocomplete && searchNodeRef.current) {
          const el = new PlaceAutocomplete();
          el.style.width = "100%";
          searchNodeRef.current.replaceChildren(el);

          const handleSelect = async (event: any) => {
            const prediction = event?.placePrediction ?? event?.detail?.placePrediction;
            const place = prediction?.toPlace?.() ?? event?.place ?? event?.detail?.place;
            if (!place) return;
            await place.fetchFields?.({ fields: ["location", "displayName", "formattedAddress"] });
            const loc = place.location;
            if (!loc) return;
            const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat;
            const lng = typeof loc.lng === "function" ? loc.lng() : loc.lng;
            map.setCenter({ lat, lng });
            map.setZoom(18);
            commit(lat, lng, place.displayName ?? place.formattedAddress ?? null);
          };

          el.addEventListener("gmp-select", handleSelect);
          el.addEventListener("gmp-placeselect", handleSelect);
        }
      } catch {
        // Search unavailable; map, drag and GPS capture still work.
      }

      setMapsState("ready");
    });

    return () => { cancelled = true; };
    // Intentionally mount-only: re-running would rebuild the map on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the drawn fence in step with the radius field and with manual edits.
  useEffect(() => {
    if (mapsState !== "ready") return;
    circleRef.current?.setRadius(radiusMeters);
  }, [radiusMeters, mapsState]);

  useEffect(() => {
    if (mapsState !== "ready" || value.latitude === null || value.longitude === null) return;
    const pos = { lat: value.latitude, lng: value.longitude };
    markerRef.current?.setPosition(pos);
    circleRef.current?.setCenter(pos);
  }, [value.latitude, value.longitude, mapsState]);

  // ── Capture from the device ───────────────────────────────────────────────
  const useCurrentLocation = () => {
    setLocateError(null);

    if (!navigator.geolocation) {
      setLocateError("This browser cannot report a location.");
      return;
    }
    if (!window.isSecureContext) {
      setLocateError("Location needs a secure (https) connection. Open the deployed site rather than a local IP address.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        onChangeRef.current({ latitude: lat, longitude: lng, label: value.label });
        if (mapRef.current) {
          mapRef.current.setCenter({ lat, lng });
          mapRef.current.setZoom(18);
        }
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was refused. Allow it for this site, or type the coordinates below."
            : "Could not get a location fix. Try again outside or near a window.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  };

  const setCoord = (key: "latitude" | "longitude", raw: string) => {
    const trimmed = raw.trim();
    onChangeRef.current({ ...value, [key]: trimmed === "" ? null : Number(trimmed) });
  };

  return (
    <div className="space-y-3">
      {mapsState !== "unavailable" && (
        <div ref={searchNodeRef} data-testid="location-search" />
      )}

      {mapsState === "unavailable" ? (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            Map search is unavailable, so set the branch position from the device instead —
            stand in the salon and tap <span className="font-medium">Use my current location</span>,
            or enter the coordinates directly.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="relative">
          <div
            ref={mapNodeRef}
            data-testid="location-map"
            className="h-64 w-full rounded-md border bg-muted"
          />
          {mapsState === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-muted/60">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={useCurrentLocation}
          disabled={disabled || locating}
          data-testid="button-use-current-location"
        >
          {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crosshair className="mr-2 h-4 w-4" />}
          Use my current location
        </Button>
        {value.label && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {value.label}
          </span>
        )}
      </div>

      {locateError && (
        <p className="text-sm text-destructive" data-testid="text-locate-error">{locateError}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="geofence-lat">Latitude</Label>
          <Input
            id="geofence-lat"
            data-testid="input-geofence-latitude"
            inputMode="decimal"
            placeholder="6.524379"
            value={value.latitude ?? ""}
            onChange={(e) => setCoord("latitude", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="geofence-lng">Longitude</Label>
          <Input
            id="geofence-lng"
            data-testid="input-geofence-longitude"
            inputMode="decimal"
            placeholder="3.379206"
            value={value.longitude ?? ""}
            onChange={(e) => setCoord("longitude", e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
