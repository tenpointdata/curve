{
  description = "Curve, a proof-oriented language and constrained optimization toolkit";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forSystems = nixpkgs.lib.genAttrs systems;
    in {
      packages = forSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = "curve";
            version = "2.0.40-curve.1";
            src = self;
            nativeBuildInputs = [ pkgs.bun pkgs.makeWrapper ];
            dontBuild = true;
            dontStrip = true;
            installPhase = ''
              runHook preInstall
              sh scripts/build.sh "$out"
              wrapProgram "$out/bin/curve" \
                --prefix PATH : "${pkgs.lib.makeBinPath ([ pkgs.bun pkgs.python3 ]
                  ++ pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.clang)}" \
                ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin "--set-default CC /usr/bin/clang"}
              runHook postInstall
            '';
            meta = {
              description = "Proof-oriented language and constrained optimization toolkit";
              homepage = "https://github.com/tenpointdata/curve";
              license = pkgs.lib.licenses.asl20;
              mainProgram = "curve";
            };
          };
        });

      apps = forSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/curve";
        };
      });
    };
}
