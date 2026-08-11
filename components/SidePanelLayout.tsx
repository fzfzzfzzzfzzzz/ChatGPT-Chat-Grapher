import type { PropsWithChildren, ReactNode } from "react";

type Props = PropsWithChildren<{
  header: ReactNode;
  footer?: ReactNode;
}>;

export function SidePanelLayout({ header, footer, children }: Props) {
  return (
    <div className="side-panel-layout">
      {header}
      <main className="side-panel-layout__content">{children}</main>
      {footer ? <footer className="side-panel-layout__footer">{footer}</footer> : null}
    </div>
  );
}
