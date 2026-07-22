const background = [
  " was taking a stroll around the neighborhood",
  //dog
  //" was taking their dog for a walk",
  //run
  " was running through a big sunny field",
  " was scouting out possible picnic spots on the grass",
  " was cheerfully frolicking in the park",
  " was running through their grandmother's huge garden",
  //bug
  //" was out and about trying to build up their bug collection",
  //butterfly, run
  " was trying to chase a pretty butterfly",
  //run
  " was training for a half marathon",
  " was walking in the meadow on the hunt for a new pet goat"
];

const action = [
  " fell onto someone's upturned rake",
  " tripped over someone's pet rock",
  //pit
  " slipped on someone's puddle of oil",
  " slipped on someone's banana peel",
  " slipped on someone's skateboard",
  " tripped over someone's pet duck",
  " fell onto someone's thorny pet plant",
  " tripped over someone's empty soda can",
  " tripped on someone's jack-o-lantern",
  " tripped over someone's piece of string"
]

const result = [
  " and was left to marinate in their big pool of blood.",
  " and was left to slowly decompose.",
  " and never got up again."
]

const saved = [
  ", but then the scent of someone's freshly baked cookies lured them away at the last second, saving their life.",
  ', but then someone screamed "WATCH OUT!!!" just in time to end up saving their life.',
  ", but then someone called their name, causing them to turn in the opposite direction and saving their life."
]
//mafia select self
//cop message
//condemn animation
//day cycle icon
function randomInt(max) {
  return Math.floor(Math.random()*max);
}

export function script(user, death) {
  var res = user;
  res+=background[randomInt(8)];
  if (death) {
    res+=" when they" + action[randomInt(10)];
    res+=result[randomInt(3)];
  } else {
    res+=" when they almost" + action[randomInt(10)];
    res+=saved[randomInt(3)];
  }
  return res;
}

// export function suicide(user, death) {
//   if (death) {
//     return user + " stuck a fork in an outlet and got electrocuted.";
//   } else {
//     return user + " tried to jump off a cliff but got saved by someone's sturdy pet eagle!";
//   }
// }

// export function cop(user, mafia) {
//   if (mafia) {
//     return user + " is the mafia!!!";
//   } else {
//     return user + " is not the mafia.";
//   }
// }
