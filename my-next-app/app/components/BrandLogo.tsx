import Image from "next/image";
import styles from "./BrandLogo.module.css";

type BrandLogoProps = {
  admin?: boolean;
  showName?: boolean;
};

export function BrandLogo({ admin = false, showName = true }: BrandLogoProps) {
  return (
    <>
      <Image
        alt=""
        aria-hidden="true"
        className={`${styles.mark} ${showName ? "" : styles.markOnly}`}
        height={1024}
        priority
        src="/fastmovie-logo.png"
        width={1536}
      />
      {showName && <strong className={styles.name}>Fast Movie</strong>}
      {admin && showName && <em className={styles.admin}>ADMIN</em>}
    </>
  );
}
