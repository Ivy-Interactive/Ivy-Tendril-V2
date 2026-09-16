import React from "react";
import { Callout } from "@ivy-interactive/components/ui";
import { SectionCard } from "./fields";

/**
 * `Apps/Settings/SecuritySetupView.cs` and the `TunnelSetupView` it composes underneath itself.
 *
 * V1's row does two things, and neither is reachable from this app:
 *
 * - **Session protection.** `SecuritySetupView` hashes a password with Argon2id (`TimeCost 3`,
 *   `MemoryCost 65536`, a per-install `HashSecret`) and writes `auth: { password, hashSecret }` into
 *   `config.yaml` itself. The daemon serves `/api/auth/login` and `/api/auth/status`, but has no
 *   route that *sets* a password, and the app's bridge exposes neither. Hashing in the webview and
 *   writing the digest through `PUT /api/config` would put the credential format in the frontend and
 *   is not something to invent here.
 * - **Tunnelling.** `TunnelSetupView` starts and stops a public tunnel to the local instance. V2 has
 *   no tunnel service at all - no config key, no route, no bridge method.
 *
 * The row is present because V1 has it and its absence was itself a divergence; the content says
 * plainly what is not wired rather than offering controls that would silently do nothing.
 */
export const SecurityTunnelingSection: React.FC = () => (
  <SectionCard
    title="Security & Tunneling"
    hint="Require a password to access Tendril, and expose this instance over a public tunnel."
    testId="security-tunneling-card"
  >
    <div className="max-w-170 space-y-4">
      <Callout.Warning data-testid="security-not-wired">
        <div className="space-y-2">
          <p>Neither half of this section is reachable from this app yet.</p>
          <p className="text-xs">
            Session protection writes an Argon2id hash into <code>auth</code> in config.yaml. The
            daemon can verify a password (<code>/api/auth/login</code>,{" "}
            <code>/api/auth/status</code>) but has no route that sets one, so there is nothing safe
            for this screen to call.
          </p>
          <p className="text-xs">
            Tunnelling has no counterpart at all in this build: no config key, no daemon route and
            no bridge method.
          </p>
        </div>
      </Callout.Warning>
    </div>
  </SectionCard>
);
