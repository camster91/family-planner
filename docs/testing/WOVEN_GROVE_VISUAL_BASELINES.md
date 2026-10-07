# Woven Grove Linux visual baselines

Approved identity: the original generated woven H and graphic, six-color semantic palette, self-hosted Newsreader and Manrope. The product remains Herewoven.

## Provenance and review

- Original source candidate: `5fde7f3f59e56466a512ccc8bc874def7a2ee4cd`.
- Automatic comparison run: `37620946376`; 25 distinct state differences inspected.
- Single hosted generation run: `37624008733`, direct checkout of the original source candidate. It generated 31 PNGs; 25 were byte-identical to the inspected automatic actuals. The six additional elevation/device-list/removal states were individually inspected.
- Independent QA reviewed all 31 states. Intentional changes are approved woven artwork, forest/evergreen semantic paints and font-induced reflow. No newly missing controls or accidental overlaps were identified within these captures. The coordinator validated every original/candidate hash and the exact repository inventory before adoption, and spot-checked actual phone login, light/dark dashboards and tablet elevation/removal comparisons.
- The copy-only offline test correction in `7055853428925a5e9ae03dd8b0aa09337963c745` does not modify rendering. Hosted E2E run `37628878276` passed its journeys/accessibility step before this adoption. Its old-baseline comparison still failed; this is not represented as a normal E2E pass.

## Invariants and limits

No comparison tolerance, mask, permission boundary, test coverage or assertion strength was changed. The offline contract remains exact text plus retry hit target, accessibility and same-address reconnect checks. These are Chromium/Linux fixture captures, not Android hardware or production-household evidence. Existing masked content is excluded from image inspection. Review and generation are not a passing final comparison; normal CI must rerun on the baseline-adoption commit before merge. The checked CI image is not asserted to be Coolify's source-build image.

## Adopted inventory

All 31 existing Linux baselines were replaced with these exact reviewed bytes:

- `e2e/__screenshots__/device.spec.ts/device-elevated-banner-fridge-landscape-1280x800-linux.png`: SHA-256 `b3f8e9b7d28f15e420c7845824a6d201c34950e62a112af9d3855afbf1a1ed3f`.
- `e2e/__screenshots__/device.spec.ts/device-elevated-banner-tablet-portrait-800x1280-linux.png`: SHA-256 `80feb80d26ca8f932815380decf58ebae8fb1db893400bae85324307e5dcdcb5`.
- `e2e/__screenshots__/device.spec.ts/device-list-fridge-landscape-1280x800-linux.png`: SHA-256 `1516f5506a0dd01962a1815fc649503c28cb6407b918c7e20c620f7da53b69fd`.
- `e2e/__screenshots__/device.spec.ts/device-list-tablet-portrait-800x1280-linux.png`: SHA-256 `43e330e901587c3a644daf04c3737b9a95150083ff03ac09d9a07dd8413ad1ae`.
- `e2e/__screenshots__/device.spec.ts/device-pair-fridge-landscape-1280x800-linux.png`: SHA-256 `ea24b5b9fcaab3a5a0151877e3e2cc7c99f3c5b8ca6ca12b1b89da61fa1cf690`.
- `e2e/__screenshots__/device.spec.ts/device-pair-tablet-portrait-800x1280-linux.png`: SHA-256 `97fa540fbf235de57c161b367391a8e39b1defcd6700f8a14be88d0edd8959d3`.
- `e2e/__screenshots__/device.spec.ts/device-removed-fridge-landscape-1280x800-linux.png`: SHA-256 `8e2dc69929f51bfa236c149161d68bdc88bfc8d8f48230a6a08cd0ba9cebf879`.
- `e2e/__screenshots__/device.spec.ts/device-removed-tablet-portrait-800x1280-linux.png`: SHA-256 `e6f60eb1ce1227d138567304fc103089ba7dec182367b931fb21dac10bae0a1a`.
- `e2e/__screenshots__/fridge.spec.ts/fridge-hub-weather-fridge-landscape-1280x800-linux.png`: SHA-256 `eafcc21a732f536299f513ffa30be66da7ff85ad5d58ca9e3c8a809db8afd214`.
- `e2e/__screenshots__/fridge.spec.ts/fridge-hub-weather-tablet-large-1920x1200-linux.png`: SHA-256 `c08f989b4999ee8269a3c580c7833073ce202ab2062350b03bebaa51aa6af650`.
- `e2e/__screenshots__/fridge.spec.ts/fridge-parent-fridge-landscape-1280x800-linux.png`: SHA-256 `7f17281ad0a521a588b444d570187fd22459d87dbb099e0e09f93011e20a4092`.
- `e2e/__screenshots__/fridge.spec.ts/fridge-parent-tablet-large-1920x1200-linux.png`: SHA-256 `b596e95aa80c110fc1650d9189c0b25ebd667773aa4476143f18829dc7618786`.
- `e2e/__screenshots__/fridge.spec.ts/fridge-parent-tablet-portrait-800x1280-linux.png`: SHA-256 `2fdb88640617eef84dc410ddea4253c621c65889a40fc86cbfffbab95ef10721`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-desktop-1366x768-linux.png`: SHA-256 `b738567bace943fea7432b8f798ffb579cff0032bdc8e07e02384c51c2c121a2`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-fridge-landscape-1280x800-linux.png`: SHA-256 `235664c43fd7ea5b1fa630a15e8be489af52f3cbfea432274a6c2c21038b6e81`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-phone-390x844-linux.png`: SHA-256 `4a498e3d2ca29c3bb20f928b4965da4e66562f5f82e2f342856e5d0f99345018`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-phone-430x932-linux.png`: SHA-256 `6a028f0bb034894a8088976772abecbcf73e6973b07fc9a18444c9d21e688541`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-tablet-large-1920x1200-linux.png`: SHA-256 `a8807d7dbe46317406788040f4877ecf5032e0e4f79bed84398b9a73a0113a58`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-dark-tablet-portrait-800x1280-linux.png`: SHA-256 `9dc4594fb8179d54be930b8d6832f9d88fcb8b24f4bc2b5df10533fad5537d31`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-desktop-1366x768-linux.png`: SHA-256 `294151fbc38ca975aefd7365c480f9cf27c10f04c9b6f030083675c879a024b1`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-fridge-landscape-1280x800-linux.png`: SHA-256 `de3e34e0f93f27ef6fa55f3baa2c82092a935c3114fc8b1fda28ec0ca7986470`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-phone-390x844-linux.png`: SHA-256 `de2672ebeedcdb58b592c85b83a49222d3e94c8aee608926cae4047073559496`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-phone-430x932-linux.png`: SHA-256 `1b6c268713bf24958139f50086b212b8df16ea5823574f5bc6ec49ff2c991731`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-tablet-large-1920x1200-linux.png`: SHA-256 `b430ae91349031b9abdcc81fd2f74682d5768189b77a47e2f613934f269e2913`.
- `e2e/__screenshots__/visual.spec.ts/dashboard-parent-light-tablet-portrait-800x1280-linux.png`: SHA-256 `fa0eb9f792f43a4f33a7d5c3d8f4290879e0cd5e23f7723b2e62cd0e650baff5`.
- `e2e/__screenshots__/visual.spec.ts/login-desktop-1366x768-linux.png`: SHA-256 `57232c46fbb47cc13fa769c0ed006b934594ec9c0db0f54fe9c03703835ba2f7`.
- `e2e/__screenshots__/visual.spec.ts/login-fridge-landscape-1280x800-linux.png`: SHA-256 `30eba4688c8458d39c05a89c8de8429d064c07dcb213d7454b7011751d82fa29`.
- `e2e/__screenshots__/visual.spec.ts/login-phone-390x844-linux.png`: SHA-256 `f0a653b39f7bd1275d849554108defa1e62c3e4b9c9d8f8f3f596fbc131c9041`.
- `e2e/__screenshots__/visual.spec.ts/login-phone-430x932-linux.png`: SHA-256 `5a2a2b5cb428d8937f7d5c67ca015a7024e6e48b4f917da2eb1937fb3a725591`.
- `e2e/__screenshots__/visual.spec.ts/login-tablet-large-1920x1200-linux.png`: SHA-256 `d0ffb53e9f1c5da70aa16de0f80a0e2ed7c7073b1b44f123a908afaad7929ac3`.
- `e2e/__screenshots__/visual.spec.ts/login-tablet-portrait-800x1280-linux.png`: SHA-256 `4254c747d543f00e2f34ff60469c333eda11eba3ebb4f00f9ebec44d45c0cb3a`.
