/** /join sits outside the auth frame, so it supplies its own main landmark. */
export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content">{children}</main>
}
