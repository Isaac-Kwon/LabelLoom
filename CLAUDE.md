# LabelLoom

## 릴리즈

"릴리즈해줘", "v0.1.3 내줘"처럼 릴리즈를 요청받으면 아래 순서를 끝까지 알아서 진행한다. 푸시까지 승인된 것으로 본다.

`v*` 태그가 푸시되면 [.github/workflows/release.yml](.github/workflows/release.yml)이 빌드해서 GitHub Release를 만들고 `LabelLoom-vX.Y.Z.html`(파일 하나로 된 앱)과 `LabelLoom-vX.Y.Z.zip`(`dist/` 전체)을 assets에 올린다. 릴리즈 노트는 `release-notes/vX.Y.Z.md`를 쓴다. 태그와 `package.json` 버전이 다르면 workflow가 실패한다.

1. 작업 트리가 깨끗하고 `main`이 `origin/main`과 같은지 확인한다. 아니면 멈추고 묻는다.
2. 버전: 사용자가 정하지 않았으면 patch를 올린다. 기능이 크게 늘었으면 minor를 제안하고 묻는다.
3. 노트 작성: 직전 태그 이후 커밋(`git log <직전 태그>..HEAD`)을 본문까지 읽고 `release-notes/vX.Y.Z.md`를 쓴다.
   - 영어, 사용자 관점. 기존 `release-notes/*.md`의 형식(`## vX.Y.Z`, `### New` / `### Improved` / `### Fixed`)과 어조를 따른다.
   - 내부 리팩터링, 버전 올림, 빌드 설정처럼 사용자가 체감하지 못하는 변경은 뺀다. UI 이름은 앱의 한글 표기를 그대로 쓴다.
4. `npm version X.Y.Z --no-git-tag-version`으로 `package.json`과 `package-lock.json`을 올리고 `npm run build`로 타입 검사와 빌드가 통과하는지 확인한다.
5. 노트와 버전 변경을 `vX.Y.Z` 메시지로 한 커밋에 담는다.
6. `git tag -a vX.Y.Z -m vX.Y.Z` 후 `git push origin main vX.Y.Z`.
7. 사용자에게 버전, 노트 요약, Actions 페이지(https://github.com/Isaac-Kwon/LabelLoom/actions) 링크를 알린다. 이 PC에는 `gh`가 없으므로 Release 생성 결과는 직접 확인하지 못했다고 밝힌다.

하지 않는 것: 이미 푸시된 태그를 옮기거나 지우기, force push. 필요하면 이유를 설명하고 묻는다.
이미 있는 태그의 Release를 다시 만들 때는 Actions → Release → Run workflow에 태그를 넣어 실행하라고 안내한다.
