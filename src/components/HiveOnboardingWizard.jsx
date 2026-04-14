"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ONBOARDING_TEAM_ROLES } from "@/lib/data/roleRepository";

const STEPS = [
  { id: "name", label: "Name your hive" },
  { id: "role", label: "Set your role" },
  { id: "invite", label: "Invite team" },
];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function buildFallbackGreeting({ hiveName, roleLabel, userName }) {
  return `Hey ${userName || "there"} - as the ${roleLabel} of ${hiveName}, I will help you capture key decisions, surface blockers, and keep your team aligned without losing the why behind the work.`;
}

export default function HiveOnboardingWizard({
  open,
  user,
  creating = false,
  onClose,
  onCreate,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [hiveName, setHiveName] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState(ONBOARDING_TEAM_ROLES[0].id);
  const [inviteInput, setInviteInput] = useState("");
  const [invites, setInvites] = useState([]);

  const deferredHiveName = useDeferredValue(hiveName.trim());
  const selectedRole = useMemo(
    () => ONBOARDING_TEAM_ROLES.find((role) => role.id === selectedRoleId) || ONBOARDING_TEAM_ROLES[0],
    [selectedRoleId]
  );
  const previewGreeting = useMemo(
    () =>
      buildFallbackGreeting({
        hiveName: deferredHiveName || "your hive",
        roleLabel: selectedRole.label,
        userName: user?.displayName || user?.email?.split("@")[0] || "there",
      }),
    [deferredHiveName, selectedRole.label, user?.displayName, user?.email]
  );

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setHiveName("");
    setSelectedRoleId(ONBOARDING_TEAM_ROLES[0].id);
    setInviteInput("");
    setInvites([]);
  }, [open]);

  if (!open) return null;

  const addInvite = () => {
    const email = normalizeEmail(inviteInput);
    if (!isValidEmail(email) || invites.includes(email)) return;
    setInvites((current) => [...current, email]);
    setInviteInput("");
  };

  const handleInviteKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addInvite();
    }
  };

  const handleNext = () => {
    if (stepIndex === 0 && !hiveName.trim()) return;
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const handleCreate = async () => {
    if (!hiveName.trim() || !selectedRole) return;

    await onCreate?.({
      hiveName: hiveName.trim(),
      teamRole: selectedRole,
      invites,
      greeting: previewGreeting,
    });
  };

  return (
    <div
      className="mission-onboarding-card"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mission-onboarding-header">
        <div>
          <span className="hero-chip">3-step setup</span>
          <h3 className="mission-hive-title mt-4">Launch a new hive</h3>
          <p className="mission-hive-description">
            Name the workspace, choose your team role, and line up invites before you drop into the live briefing.
          </p>
        </div>

        <button type="button" className="button-ghost" onClick={onClose} disabled={creating}>
          Close
        </button>
      </div>

      <div className="mission-onboarding-progress">
        {STEPS.map((step, index) => {
          const active = index === stepIndex;
          const complete = index < stepIndex;

          return (
            <div key={step.id} className="mission-onboarding-progress-step">
              <div
                className={`mission-onboarding-step-pill ${active ? "is-active" : ""} ${
                  complete ? "is-complete" : ""
                }`}
              >
                <span>{index + 1}</span>
                <span>{step.label}</span>
              </div>
              {index < STEPS.length - 1 ? (
                <div
                  className={`mission-onboarding-progress-line ${
                    complete ? "is-complete" : ""
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mission-onboarding-body">
        {stepIndex === 0 ? (
          <section className="mission-onboarding-panel">
            <p className="text-kicker">Step 1 of 3</p>
            <h4 className="panel-title mt-3 text-2xl">What should the hive be called?</h4>
            <p className="panel-subtitle mt-3">
              Pick the project, team, or mission name your collaborators will recognize right away.
            </p>

            <label className="mt-6 block">
              <span className="label-text">Hive name</span>
              <input
                type="text"
                value={hiveName}
                onChange={(event) => setHiveName(event.target.value)}
                placeholder="Backend API, Sprint 12, Product Ops..."
                className="input-shell"
                disabled={creating}
              />
            </label>
          </section>
        ) : null}

        {stepIndex === 1 ? (
          <section className="mission-onboarding-panel">
            <p className="text-kicker">Step 2 of 3</p>
            <h4 className="panel-title mt-3 text-2xl">What is your role on the team?</h4>
            <p className="panel-subtitle mt-3">
              This shapes the greeting, onboarding copy, and how the hive introduces itself.
            </p>

            <div className="mission-role-grid mt-6">
              {ONBOARDING_TEAM_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`mission-role-card ${
                    selectedRoleId === role.id ? "is-selected" : ""
                  }`}
                  disabled={creating}
                >
                  <div className="mission-role-card-icon" aria-hidden="true">
                    {role.id === "founder" ? "F" : role.id === "lead-dev" ? "LD" : "TM"}
                  </div>
                  <div>
                    <div className="mission-role-card-title">{role.label}</div>
                    <div className="mission-role-card-copy">{role.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mission-greeting-preview mt-6">
              <div className="mission-greeting-preview-label">First message preview</div>
              <p>{previewGreeting}</p>
            </div>
          </section>
        ) : null}

        {stepIndex === 2 ? (
          <section className="mission-onboarding-panel">
            <p className="text-kicker">Step 3 of 3</p>
            <h4 className="panel-title mt-3 text-2xl">Invite teammates</h4>
            <p className="panel-subtitle mt-3">
              Add a few emails now or skip and invite later from inside the hive.
            </p>

            <div className="mission-invite-shell mt-6">
              <div className="mission-invite-row">
                <input
                  type="email"
                  value={inviteInput}
                  onChange={(event) => setInviteInput(event.target.value)}
                  onKeyDown={handleInviteKeyDown}
                  placeholder="Enter email address..."
                  className="input-shell"
                  disabled={creating}
                />
                <button
                  type="button"
                  onClick={addInvite}
                  className="button-ghost"
                  disabled={!isValidEmail(inviteInput) || creating}
                >
                  Add
                </button>
              </div>

              {invites.length ? (
                <div className="mission-invite-chip-row">
                  {invites.map((email) => (
                    <button
                      key={email}
                      type="button"
                      className="mission-invite-chip"
                      onClick={() =>
                        setInvites((current) => current.filter((item) => item !== email))
                      }
                      disabled={creating}
                      title="Remove invite"
                    >
                      <span>{email}</span>
                      <span aria-hidden="true">x</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mission-empty-state mt-4">
                  No invites added yet. You can skip now and invite later from settings.
                </div>
              )}
            </div>

            <div className="mission-greeting-preview mt-6">
              <div className="mission-greeting-preview-label">Ready to launch</div>
              <p>{previewGreeting}</p>
            </div>
          </section>
        ) : null}
      </div>

      <div className="mission-onboarding-actions">
        <button
          type="button"
          className="button-ghost"
          onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
          disabled={creating || stepIndex === 0}
        >
          Back
        </button>

        {stepIndex < STEPS.length - 1 ? (
          <button
            type="button"
            className="button-primary"
            onClick={handleNext}
            disabled={creating || (stepIndex === 0 && !hiveName.trim())}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="button-primary"
            onClick={handleCreate}
            disabled={creating || !hiveName.trim()}
          >
            {creating ? "Creating hive..." : "Create hive"}
          </button>
        )}
      </div>
    </div>
  );
}
