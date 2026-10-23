import Image from "next/image";

export default function AvatarPhoto({
  src,
  name,
  className,
}: {
  src: string;
  name: string;
  className: string;
}) {
  return (
    <Image src={src} alt={name} width={80} height={80} className={className} />
  );
}
