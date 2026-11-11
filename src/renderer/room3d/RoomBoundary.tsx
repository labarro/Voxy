import { Component, type ReactNode } from "react";
export class RoomBoundary extends Component<
  { children: ReactNode; fallback: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.fallback();
  }
  render() {
    return this.state.failed ? (
      <p role="alert">A sala não carregou. Use a visualização tradicional.</p>
    ) : (
      this.props.children
    );
  }
}
