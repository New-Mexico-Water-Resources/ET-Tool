import { useEffect } from "react";
import { useMap } from "react-leaflet";
import nasaLogo from "../assets/logos/gray-nasa-tribrand-logo.svg";

const MapAttribution = () => {
  const map = useMap();

  useEffect(() => {
    const attributionContainer = document.createElement("div");
    attributionContainer.className = "map-attribution";
    attributionContainer.style.position = "absolute";
    attributionContainer.style.bottom = "20px";
    attributionContainer.style.right = "20px";
    attributionContainer.style.zIndex = "1000";
    attributionContainer.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
    attributionContainer.style.borderRadius = "4px";
    attributionContainer.style.display = "flex";
    attributionContainer.style.gap = "12px";
    attributionContainer.style.alignItems = "center";

    const nasaImg = document.createElement("img");
    nasaImg.src = nasaLogo;
    nasaImg.alt = "NASA";
    nasaImg.style.height = "50px";
    nasaImg.style.width = "auto";

    attributionContainer.appendChild(nasaImg);
    map.getContainer().appendChild(attributionContainer);

    return () => {
      map.getContainer().removeChild(attributionContainer);
    };
  }, [map]);

  return null;
};

export default MapAttribution;
