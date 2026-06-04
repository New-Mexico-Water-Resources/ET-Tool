import React from "react";
import ReactDOM from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";

import App from "./App.tsx";
import "./index.css";
import { configureLeafletDefaultIcons } from "./utils/leafletIcons.ts";

configureLeafletDefaultIcons();
import { authConfig } from "./utils/constants.tsx";
import { AuthProvider } from "./utils/authContext.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Auth0Provider
      domain={authConfig.domain}
      clientId={authConfig.clientId}
      authorizationParams={{
        audience: authConfig.audience,
        redirect_uri: window.location.origin,
      }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </Auth0Provider>
  </React.StrictMode>
);
