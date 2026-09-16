import type { Cover } from "../contracts/workspace";

export function CoverArt({
  cover,
  image,
  fit = false,
  className = "",
}: {
  cover: Cover;
  image?: string | null;
  fit?: boolean;
  className?: string;
}) {
  if (image)
    return (
      <div
        className={`cover-art cover-uploaded ${className}`}
        aria-hidden="true"
      >
        <img
          src={image}
          alt=""
          style={{ objectFit: fit ? "contain" : "cover" }}
        />
      </div>
    );
  return (
    <div className={`cover-art cover-${cover} ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {cover === "paper" && (
          <g stroke="currentColor" strokeWidth="1.2">
            <path d="M135 123V37l62-15 68 25v86l-68-25-62 15Z" />
            <path d="m135 37 62 25 68-15M197 62v86M149 48v58l33-8V60M211 76l40-9M211 89l40-9M211 102l27-6" />
            <path d="m111 136 83 17 99-24" opacity=".3" />
          </g>
        )}
        {cover === "sage" && (
          <g stroke="currentColor" strokeWidth="1.1">
            <circle cx="202" cy="82" r="54" />
            <ellipse
              cx="202"
              cy="82"
              rx="81"
              ry="25"
              transform="rotate(-26 202 82)"
            />
            <ellipse cx="202" cy="82" rx="26" ry="54" />
            <path d="M148 82h108M154 58h96M154 106h96" />
            <circle cx="131" cy="114" r="6" fill="currentColor" />
            <path d="M290 30v14m-7-7h14" />
          </g>
        )}
        {cover === "sand" && (
          <g stroke="currentColor" strokeWidth="1.2">
            <path d="M112 127h176M134 127V60h29v67M182 127V35h29v92M230 127V76h29v51" />
            <path d="m120 43 43-17 31 4 53-15" />
            <circle cx="247" cy="15" r="4" fill="currentColor" />
            <path
              d="M134 68h29M182 43h29M230 84h29M104 134h192"
              opacity=".45"
            />
          </g>
        )}
        {cover === "ink" && (
          <g stroke="currentColor" strokeWidth="1">
            <path d="m200 20 70 40v40l-70 40-70-40V60l70-40Z" />
            <path d="m130 60 70 40 70-40M200 100v40M165 40l70 40v40M235 40l-70 40v40M130 80l70 40 70-40" />
            <circle cx="200" cy="20" r="3" fill="currentColor" />
            <circle cx="270" cy="100" r="3" fill="currentColor" />
            <path d="M98 40h12m-6-6v12M293 128h12m-6-6v12" opacity=".5" />
          </g>
        )}
        {cover === "blue" && (
          <g stroke="currentColor" strokeWidth="1.2">
            <path d="M80 130c32-72 66-72 100 0M144 130c47-111 79-111 132 0M233 130c35-51 68-51 98 0M71 137h262" />
            <circle cx="279" cy="43" r="17" />
            <path d="M96 42h41m-33 8h25M302 78h32" opacity=".5" />
          </g>
        )}
        {cover === "clay" && (
          <g stroke="currentColor" strokeWidth="1.2">
            <path d="m124 114 23-85 40 11-23 85-40-11ZM174 125V45h40v80h-40ZM222 125V62h40v63h-40Z" />
            <path d="m132 91 39 11M141 55l39 11M181 54h26M181 64h26M229 106h26M112 131h164" />
            <circle cx="242" cy="83" r="7" />
          </g>
        )}
      </svg>
    </div>
  );
}
