const main = async () => {
    const response = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`,
        {
            method: "GET",
        }
    );

    const token = await response.text();

}

main();