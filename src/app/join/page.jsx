import JoinHoneycombRequest from "@/components/JoinHoneycombRequest";

export default function JoinPage() {
  return (
    <div className="page-shell">
      <div className="page-frame">
        <section className="hero-panel">
          <div className="stack-grid items-start">
            <div className="space-y-5">
              <span className="hero-chip">Invite-only access</span>
              <div>
                <p className="text-kicker">Join an active conversation</p>
                <h1 className="text-display">
                  <span className="text-gradient">Step into the right honeycomb.</span>
                </h1>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-slate-200/85">
                Drop in with an ID, request approval, and keep the membership flow clean for
                owners and collaborators.
              </p>
            </div>

            <JoinHoneycombRequest />
          </div>
        </section>
      </div>
    </div>
  );
}
