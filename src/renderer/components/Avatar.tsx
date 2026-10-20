export function Avatar({
  avatar,
  className = "avatar",
}: {
  avatar: string;
  className?: string;
}) {
  return (
    <span className={"profile-avatar " + className}>
      <span>{avatar}</span>
    </span>
  );
}
