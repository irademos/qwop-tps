// /characters/PlayerCharacter.js
import { CharacterBase } from "./CharacterBase.js";
import { createPlayerModel } from "../models/playerModel.js";
import * as THREE from "three";

export class PlayerCharacter extends CharacterBase {
  constructor(username) {
    const { model, nameLabel } = createPlayerModel(
      THREE,
      username,
      ({ mixer, actions }) => {
        this.mixer = mixer;
        this.actions = actions;
      }
    );
    super(model);
    this.nameLabel = nameLabel;
  }
}
