# Deep Bayesian REFoCUS

Project page: **https://swpenninga.github.io/deep-bayesian-refocus/**

Flow-matching diffusion prior trained directly on raw multistatic IQ, inverted with
diffusion posterior sampling (DPS) to recover the full multistatic dataset from a
single encoded acquisition.

> Code and data are released with the paper. This repository currently hosts the
> project page only.

## Layout

```text
docs/                 the GitHub Pages site (Settings -> Pages -> main / docs)
  index.html          the page itself
  static/css|js       styles and scripts
  static/images/      figures (empty until the final ones land)
```

## Editing the page

`docs/index.html` is plain HTML with no build step: edit, commit, push, and GitHub
Pages redeploys within a minute or so. Every spot that still needs real content is
marked with a `TODO` comment.
